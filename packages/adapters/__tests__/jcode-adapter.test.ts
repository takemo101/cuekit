import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, runMigrations } from "@cuekit/store";
import { buildJcodeReplLaunchCommand, createJcodeAdapter } from "../src/jcode-adapter.ts";
import { PaneBackend } from "../src/pane-backend.ts";
import { FakeTmuxRunner, hasTmux } from "../src/testing.ts";

let db: Database;
let panes: PaneBackend;
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
	panes = new PaneBackend({ runner, sendKeysDelayMs: 0 });
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

describe("buildJcodeReplLaunchCommand", () => {
	it("uses jcode repl and keeps stdin open for steering", () => {
		const launch = buildJcodeReplLaunchCommand({
			agent_kind: "jcode",
			objective: "Say 'hello' and wait",
		});

		expect(launch).toContain("mkfifo");
		expect(launch).toContain("printf '%s\\n'");
		expect(launch).toContain('; cat < /dev/tty) > "$fifo" & feeder_pid=$!;');
		expect(launch).toContain("'jcode' repl --no-update < \"$fifo\"");
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

const realTmuxSuite = hasTmux() ? describe : describe.skip;

realTmuxSuite("JcodeAdapter (real tmux integration)", () => {
	let realDb: Database;
	let realPanes: PaneBackend;
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
		realPanes = new PaneBackend({ sendKeysDelayMs: 0 });
	});

	afterEach(async () => {
		const rows = realDb.prepare("select id from tasks where agent_kind = 'jcode'").all() as Array<{
			id: string;
		}>;
		for (const row of rows) {
			try {
				await realPanes.killTask(row.id);
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
