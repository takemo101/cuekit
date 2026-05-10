import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, runMigrations } from "@cuekit/store";
import {
	buildJcodeLaunchCommand,
	buildJcodeReplLaunchCommand,
	buildJcodeRunLaunchCommand,
	createJcodeAdapter,
} from "../src/jcode-adapter.ts";
import { TmuxBackend } from "../src/tmux-backend.ts";
import { FakeTmuxRunner, hasTmux } from "../src/testing.ts";

let db: Database;
let panes: TmuxBackend;
let runner: FakeTmuxRunner;

beforeEach(() => {
	db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	createSession(db, {
		id: "s1",
		project_root: "/p",
		worktree_path: "/w",
		parent_agent_kind: "pi",
	});
	runner = new FakeTmuxRunner();
	panes = new TmuxBackend({ runner, sendKeysDelayMs: 0 });
});

describe("createJcodeAdapter", () => {
	it("declares attach, steering, and model-selection support", () => {
		const adapter = createJcodeAdapter(db, panes);
		const caps = adapter.capabilities();

		expect(adapter.kind).toBe("jcode");
		expect(caps.agent_kind).toBe("jcode");
		expect(caps.supports_attach).toBe(true);
		expect(caps.supports_steering).toBe(true);
		expect(caps.supports_model_selection).toBe(true);
		expect(caps.supports_artifacts).toBe(true);
		expect(caps.supports_live_progress).toBe(false);
		expect(caps.default_mode).toBe("interactive");
		expect(caps.supported_modes).toEqual(["interactive", "batch"]);
	});

	it("accepts custom model names", async () => {
		const adapter = createJcodeAdapter(db, panes, {
			launchCommandOverride: () => "sleep 60",
		});

		const result = await adapter.submit({
			spec: {
				agent_kind: "jcode",
				objective: "investigate",
				model: "custom-model",
			},
			session_id: "s1",
		});

		expect(result.ok).toBe(true);
	});

	it("end-to-end: submit → status with attach_hint", async () => {
		const adapter = createJcodeAdapter(db, panes, {
			launchCommandOverride: () => "sleep 60",
		});

		const result = await adapter.submit({
			spec: { agent_kind: "jcode", objective: "investigate" },
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const view = await adapter.status(result.value.task_id);
		expect(view.agent_kind).toBe("jcode");
		expect(view.status).toBe("running");
		expect(view.attach_hint).toContain("cuekit-task-");
	});
});

describe("buildJcodeLaunchCommand", () => {
	it("uses REPL mode by default", () => {
		const launch = buildJcodeLaunchCommand({ agent_kind: "jcode", objective: "x" });

		expect(launch).toContain("repl --no-update");
		expect(launch).not.toContain("jcode' run");
	});

	it("uses run mode for batch tasks", () => {
		const launch = buildJcodeLaunchCommand({
			agent_kind: "jcode",
			objective: "x",
			adapter_options: { mode: "batch" },
		});

		expect(launch).toStartWith("'jcode' run --no-update -- '");
		expect(launch).not.toContain("mkfifo");
		expect(launch).not.toContain("cat < /dev/tty");
	});
});

describe("buildJcodeReplLaunchCommand", () => {
	it("uses jcode repl and keeps stdin open for steering", () => {
		const launch = buildJcodeReplLaunchCommand({
			agent_kind: "jcode",
			objective: "Say 'hello' and wait",
		});

		expect(launch).toContain("mkfifo");
		expect(launch).toContain("printf '%s\\n'");
		expect(launch).toContain('; cat < /dev/tty) > "$fifo" & feeder_pid=$!;');
		expect(launch).toContain("'jcode' repl --no-update < \"$fifo\" & jcode_pid=$!");
		expect(launch).toContain('wait "$jcode_pid";');
		expect(launch).toContain('jcode_home="' + "$" + '{JCODE_HOME:-$HOME/.jcode}";');
		expect(launch).toContain('rm -f "$pid_file"');
		expect(launch).toContain("Say '\\''hello'\\'' and wait");
		expect(launch).toContain("Child reporting contract:");
		expect(launch).not.toContain("jcode run");
	});

	it("shell-quotes model names", () => {
		const launch = buildJcodeReplLaunchCommand({
			agent_kind: "jcode",
			objective: "x",
			model: "weird model's name",
		});

		expect(launch).toContain("--model 'weird model'\\''s name'");
	});

	it("respects and shell-quotes a custom jcode binary", () => {
		const launch = buildJcodeReplLaunchCommand(
			{ agent_kind: "jcode", objective: "x" },
			{ jcodeBin: "/opt/bin/jcode with spaces" },
		);

		expect(launch).toContain("'/opt/bin/jcode with spaces' repl --no-update");
	});

	it("adds jcode-specific guidance for foreground validation and terminal reporting", () => {
		const launch = buildJcodeReplLaunchCommand({ agent_kind: "jcode", objective: "x" });

		expect(launch).toContain("Jcode adapter guidance:");
		expect(launch).toContain("Run validation commands in the foreground");
		expect(launch).toContain("validation command that is expected to terminate");
		expect(launch).toContain("dev servers or watchers");
		expect(launch).toContain("Report completed, failed, or blocked through cuekit before exiting");
	});

	it("passes string provider_profile adapter options to jcode", () => {
		const launch = buildJcodeReplLaunchCommand({
			agent_kind: "jcode",
			objective: "x",
			adapter_options: { provider_profile: "work profile" },
		});

		expect(launch).toContain("--provider-profile 'work profile'");
	});

	it("ignores non-string or empty provider_profile adapter options", () => {
		const numeric = buildJcodeReplLaunchCommand({
			agent_kind: "jcode",
			objective: "x",
			adapter_options: { provider_profile: 123 },
		});
		const empty = buildJcodeReplLaunchCommand({
			agent_kind: "jcode",
			objective: "x",
			adapter_options: { provider_profile: "" },
		});

		expect(numeric).not.toContain("--provider-profile");
		expect(empty).not.toContain("--provider-profile");
	});

	it("exits when the jcode process exits before the feeder receives more input", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cuekit-jcode-test-"));
		const fakeJcode = join(dir, "jcode-fake");
		writeFileSync(fakeJcode, "#!/bin/sh\nexit 7\n", { mode: 0o755 });
		try {
			const launch = buildJcodeReplLaunchCommand(
				{ agent_kind: "jcode", objective: "x" },
				{ jcodeBin: fakeJcode },
			);
			const proc = Bun.spawn(["sh", "-c", launch], {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			});

			const completed = await Promise.race([
				proc.exited.then((exitCode) => ({ exitCode })),
				Bun.sleep(500).then(() => ({ exitCode: null })),
			]);
			if (completed.exitCode === null) {
				proc.kill();
			}

			expect(completed.exitCode).toBe(7);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("buildJcodeRunLaunchCommand", () => {
	it("uses jcode run without FIFO feeder", () => {
		const launch = buildJcodeRunLaunchCommand({ agent_kind: "jcode", objective: "x" });

		expect(launch).toStartWith("'jcode' run --no-update -- '");
		expect(launch).not.toContain("mkfifo");
		expect(launch).not.toContain("cat < /dev/tty");
		expect(launch).toContain("Jcode adapter guidance:");
	});

	it("protects option-looking prompts with an option terminator", () => {
		const launch = buildJcodeRunLaunchCommand({ agent_kind: "jcode", objective: "--help" });

		expect(launch).toContain(" -- '--help");
	});

	it("preserves model and provider profile flags", () => {
		const launch = buildJcodeRunLaunchCommand({
			agent_kind: "jcode",
			objective: "x",
			model: "custom model",
			adapter_options: { provider_profile: "work profile" },
		});

		expect(launch).toContain("--provider-profile 'work profile'");
		expect(launch).toContain("--model 'custom model'");
	});
});

const realTmuxSuite = hasTmux() ? describe : describe.skip;

realTmuxSuite("JcodeAdapter (real tmux integration)", () => {
	let realDb: Database;
	let realPanes: TmuxBackend;
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "cuekit-jcode-integ-"));
		realDb = new Database(":memory:");
		realDb.exec("pragma foreign_keys = ON;");
		runMigrations(realDb);
		createSession(realDb, {
			id: "s1",
			project_root: tmpRoot,
			worktree_path: tmpRoot,
			parent_agent_kind: "pi",
		});
		realPanes = new TmuxBackend({ sendKeysDelayMs: 0 });
	});

	afterEach(async () => {
		const rows = realDb.prepare("select id from tasks where agent_kind = 'jcode'").all() as Array<{
			id: string;
		}>;
		for (const row of rows) {
			try {
				await realPanes.killPane(row.id);
			} catch {
				// ignore — may already be gone
			}
		}
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("steer() reaches the REPL stdin after the initial prompt", async () => {
		const markerPath = join(tmpRoot, "marker.txt");
		const fakeJcode = join(tmpRoot, "jcode-fake");
		writeFileSync(
			fakeJcode,
			`#!/bin/sh
while IFS= read -r line; do
	case "$line" in
		*steering-marker*) printf '%s\\n' "$line" > '${markerPath.replace(/'/g, "'\\''")}'; exit 0 ;;
	esac
done
exit 9
`,
			{ mode: 0o755 },
		);
		const adapter = createJcodeAdapter(realDb, realPanes, { jcodeBin: fakeJcode });

		const result = await adapter.submit({
			spec: { agent_kind: "jcode", objective: "wait for steering" },
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const marker = `steering-marker-${Date.now()}`;
		const ack = await adapter.steer({ task_id: result.value.task_id, message: marker });
		expect(ack.ok).toBe(true);

		for (let i = 0; i < 20 && !existsSync(markerPath); i += 1) {
			await Bun.sleep(100);
		}
		expect(existsSync(markerPath)).toBe(true);
	});
});
