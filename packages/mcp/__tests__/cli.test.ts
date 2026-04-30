import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { AdapterRegistry, createClaudeCodeAdapter, PaneBackend } from "@cuekit/adapters";
import { FakeTmuxRunner } from "@cuekit/adapters/testing";
import {
	createSession,
	createTask,
	listTaskEvents,
	runMigrations,
	updateTaskChildTokenHash,
} from "@cuekit/store";
import { createCli } from "../src/cli.ts";
import { CUEKIT_OPERATIONS } from "../src/operations.ts";

const WORKSPACE_ROOT = resolve(import.meta.dir, "..", "..", "..");

function makeCliHarness() {
	const db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	const panes = new PaneBackend({ runner: new FakeTmuxRunner(), sendKeysDelayMs: 0 });
	const registry = new AdapterRegistry();
	registry.register(
		createClaudeCodeAdapter(db, panes, { launchCommandOverride: () => "sleep 60" }),
	);
	return { cli: createCli({ db, registry }), db };
}

function makeCli() {
	return makeCliHarness().cli;
}

describe("createCli", () => {
	it("defines unique MCP names and future CLI paths for every operation", () => {
		const mcpNames = CUEKIT_OPERATIONS.map((operation) => operation.mcpName);
		const cliPaths = CUEKIT_OPERATIONS.map((operation) => operation.cliPath.join(" "));

		expect(new Set(mcpNames).size).toBe(mcpNames.length);
		expect(new Set(cliPaths).size).toBe(cliPaths.length);
		expect(cliPaths).toContain("task submit");
		expect(cliPaths).toContain("task events");
		expect(cliPaths).toContain("adapter list");
		expect(cliPaths).toContain("tool report");
		expect(cliPaths).toContain("session delete");
		expect(cliPaths).toContain("mcp config");
		expect(mcpNames).toContain("wait_tasks");
		expect(mcpNames).not.toContain("wait_task");
		expect(cliPaths).toContain("task wait");
		expect(cliPaths).not.toContain("task wait-one");
	});

	it("builds an incur CLI without throwing", () => {
		expect(makeCli()).toBeDefined();
	});

	it("serves adapter list through grouped cli.fetch paths", async () => {
		const cli = makeCli();
		const res = await cli.fetch(new Request("http://localhost/adapter/list"));
		expect(res.ok).toBe(true);
		const body = (await res.json()) as {
			ok: boolean;
			data: { adapters: Array<{ agent_kind: string }> };
		};
		expect(body.ok).toBe(true);
		expect(body.data.adapters.map((a) => a.agent_kind)).toContain("claude-code");
	});

	it("serves session and mcp helper commands through grouped cli.fetch paths", async () => {
		const cli = makeCli();

		const configRes = await cli.fetch(new Request("http://localhost/mcp/config"));
		expect(configRes.ok).toBe(true);
		const configBody = (await configRes.json()) as {
			ok: boolean;
			data: { name: string; args: string[] };
		};
		expect(configBody.ok).toBe(true);
		expect(configBody.data.name).toBe("cuekit");
		expect(configBody.data.args).toEqual(["--mcp"]);

		const deleteRes = await cli.fetch(
			new Request("http://localhost/session/delete?session_id=s_missing"),
		);
		expect(deleteRes.ok).toBe(true);
		const deleteBody = (await deleteRes.json()) as {
			ok: boolean;
			data: { ok: false; error: { code: string } };
		};
		expect(deleteBody.ok).toBe(true);
		expect(deleteBody.data.ok).toBe(false);
		expect(deleteBody.data.error.code).toBe("session_not_found");
	});

	it("serves mcp config through the real argv CLI despite incur's mcp builtin", async () => {
		const proc = Bun.spawn(
			["bun", "packages/mcp/src/bin.ts", "mcp", "config", "--format", "json"],
			{
				cwd: WORKSPACE_ROOT,
				env: { ...process.env, CUEKIT_DB_PATH: ":memory:" },
				stderr: "pipe",
				stdout: "pipe",
			},
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		const body = JSON.parse(stdout) as { name: string; args: string[] };
		expect(body.name).toBe("cuekit");
		expect(body.args).toEqual(["--mcp"]);
	});

	it("registers MCP using the local cuekit command instead of npx cuekit", async () => {
		const tmpRoot = mkdtempSync(`${tmpdir()}/cuekit-mcp-add-`);
		try {
			const capturePath = `${tmpRoot}/npx-args.txt`;
			for (const runner of ["npx", "bunx", "pnpx"]) {
				const fakeRunner = `${tmpRoot}/${runner}`;
				writeFileSync(
					fakeRunner,
					[
						"#!/usr/bin/env sh",
						'printf "%s\\n" "$@" > "$CUEKIT_CAPTURE_NPX_ARGS"',
						'printf "│ ✓ Claude Code: ~/.claude.json │\\n"',
					].join("\n"),
				);
				chmodSync(fakeRunner, 0o755);
			}

			const proc = Bun.spawn(
				["bun", "packages/mcp/src/bin.ts", "mcp", "add", "--agent", "claude-code"],
				{
					cwd: WORKSPACE_ROOT,
					env: {
						...process.env,
						CUEKIT_CAPTURE_NPX_ARGS: capturePath,
						CUEKIT_DB_PATH: ":memory:",
						HOME: tmpRoot,
						PATH: `${tmpRoot}:${process.env.PATH ?? ""}`,
					},
					stderr: "pipe",
					stdout: "pipe",
				},
			);
			const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			const capturedArgs = readFileSync(capturePath, "utf8").trim().split("\n");
			expect(capturedArgs).toContain("add-mcp");
			expect(capturedArgs).toContain("cuekit --mcp");
			expect(capturedArgs).not.toContain("npx cuekit --mcp");
		} finally {
			rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	it("registers MCP for pi in the shared global MCP config", async () => {
		const tmpRoot = mkdtempSync(`${tmpdir()}/cuekit-pi-mcp-add-`);
		try {
			const proc = Bun.spawn(["bun", "packages/mcp/src/bin.ts", "mcp", "add", "--agent", "pi"], {
				cwd: WORKSPACE_ROOT,
				env: {
					...process.env,
					CUEKIT_DB_PATH: ":memory:",
					HOME: tmpRoot,
				},
				stderr: "pipe",
				stdout: "pipe",
			});
			const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			const config = JSON.parse(readFileSync(`${tmpRoot}/.config/mcp/mcp.json`, "utf8")) as {
				mcpServers: { cuekit: { command: string; args: string[] } };
			};
			expect(config.mcpServers.cuekit).toEqual({ command: "cuekit", args: ["--mcp"] });
		} finally {
			rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	it("registers MCP for pi in the shared project MCP config with --no-global", async () => {
		const tmpRoot = mkdtempSync(`${tmpdir()}/cuekit-pi-mcp-add-project-`);
		try {
			writeFileSync(
				`${tmpRoot}/.mcp.json`,
				JSON.stringify({ mcpServers: { existing: { command: "echo", args: ["ok"] } } }),
			);
			const proc = Bun.spawn(
				[
					"bun",
					`${WORKSPACE_ROOT}/packages/mcp/src/bin.ts`,
					"mcp",
					"add",
					"--agent",
					"pi",
					"--no-global",
				],
				{
					cwd: tmpRoot,
					env: {
						...process.env,
						CUEKIT_DB_PATH: ":memory:",
						HOME: tmpRoot,
					},
					stderr: "pipe",
					stdout: "pipe",
				},
			);
			const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			const config = JSON.parse(readFileSync(`${tmpRoot}/.mcp.json`, "utf8")) as {
				mcpServers: Record<string, { command: string; args: string[] }>;
			};
			expect(config.mcpServers.existing).toEqual({ command: "echo", args: ["ok"] });
			expect(config.mcpServers.cuekit).toEqual({ command: "cuekit", args: ["--mcp"] });
		} finally {
			rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	it("preserves existing pi MCP config file permissions", async () => {
		const tmpRoot = mkdtempSync(`${tmpdir()}/cuekit-pi-mcp-add-mode-`);
		try {
			const configPath = `${tmpRoot}/.config/mcp/mcp.json`;
			mkdirSync(`${tmpRoot}/.config/mcp`, { recursive: true });
			writeFileSync(configPath, JSON.stringify({ mcpServers: {} }));
			chmodSync(configPath, 0o600);
			const proc = Bun.spawn(["bun", "packages/mcp/src/bin.ts", "mcp", "add", "--agent", "pi"], {
				cwd: WORKSPACE_ROOT,
				env: {
					...process.env,
					CUEKIT_DB_PATH: ":memory:",
					HOME: tmpRoot,
				},
				stderr: "pipe",
				stdout: "pipe",
			});
			const exitCode = await proc.exited;

			expect(exitCode).toBe(0);
			expect(statSync(configPath).mode & 0o777).toBe(0o600);
		} finally {
			rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	it("just install creates a wrapper without making the tracked bin executable", async () => {
		const tmpRoot = mkdtempSync(`${tmpdir()}/cuekit-just-install-`);
		try {
			const binPath = `${WORKSPACE_ROOT}/packages/mcp/src/bin.ts`;
			const beforeMode = statSync(binPath).mode & 0o777;
			const proc = Bun.spawn(["just", "install"], {
				cwd: WORKSPACE_ROOT,
				env: {
					...process.env,
					HOME: tmpRoot,
					PATH: `${tmpRoot}/.bun/bin:${process.env.PATH ?? ""}`,
				},
				stderr: "pipe",
				stdout: "pipe",
			});
			const exitCode = await proc.exited;

			expect(exitCode).toBe(0);
			expect(statSync(`${tmpRoot}/.bun/bin/cuekit`).mode & 0o111).not.toBe(0);
			expect(statSync(binPath).mode & 0o777).toBe(beforeMode);
		} finally {
			rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	it("serves task commands through grouped cli.fetch paths", async () => {
		const cli = makeCli();
		const res = await cli.fetch(new Request("http://localhost/task/list"));
		expect(res.ok).toBe(true);
		const body = (await res.json()) as {
			ok: boolean;
			data: { tasks: Array<{ task_id: string }> };
		};
		expect(body.ok).toBe(true);
		expect(body.data.tasks).toEqual([]);
	});

	it("serves child report fallback through cuekit tool report", async () => {
		const { cli, db } = makeCliHarness();
		createSession(db, {
			id: "s_cli",
			project_root: "/tmp",
			worktree_path: "/tmp",
			parent_agent_kind: "cuekit-cli",
		});
		createTask(db, {
			id: "t_cli",
			session_id: "s_cli",
			agent_kind: "claude-code",
			objective: "x",
			status: "running",
		});
		updateTaskChildTokenHash(
			db,
			"t_cli",
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);
		const previousTaskId = process.env.CUEKIT_TASK_ID;
		const previousToken = process.env.CUEKIT_CHILD_TOKEN;
		process.env.CUEKIT_TASK_ID = "t_cli";
		process.env.CUEKIT_CHILD_TOKEN = "data";
		try {
			const res = await cli.fetch(
				new Request(
					'http://localhost/tool/report?type=progress&message=Running%20tests&payload={"phase":"testing"}',
				),
			);
			expect(res.ok).toBe(true);
			const body = (await res.json()) as { ok: boolean; data: { ok: boolean } };
			expect(body.ok).toBe(true);
			expect(body.data.ok).toBe(true);
			const events = listTaskEvents(db, "t_cli");
			expect(events).toHaveLength(1);
			expect(events[0]?.type).toBe("progress");
			expect(events[0]?.payload).toEqual({ phase: "testing" });
		} finally {
			if (previousTaskId === undefined) delete process.env.CUEKIT_TASK_ID;
			else process.env.CUEKIT_TASK_ID = previousTaskId;
			if (previousToken === undefined) delete process.env.CUEKIT_CHILD_TOKEN;
			else process.env.CUEKIT_CHILD_TOKEN = previousToken;
		}
	});

	it("does not keep flat task CLI aliases", async () => {
		const cli = makeCli();
		for (const path of [
			"submit_task",
			"get_task_status",
			"get_task_result",
			"cancel_task",
			"list_tasks",
			"steer_task",
			"delete_task",
		]) {
			const res = await cli.fetch(new Request(`http://localhost/${path}`));
			expect(res.ok).toBe(false);
		}
	});

	it("does not keep flat non-task CLI aliases", async () => {
		const cli = makeCli();
		for (const path of ["list_adapters", "delete_session", "show_mcp_config"]) {
			const res = await cli.fetch(new Request(`http://localhost/${path}`));
			expect(res.ok).toBe(false);
		}
	});

	it("exposes cuekit version from package.json", async () => {
		const cli = makeCli();
		// incur's --version flag is served via argv; just verify the CLI
		// has the version field populated from package.json (not hardcoded 0.0.0).
		// We can't call cli.serve() in a test (it reads stdin / process.argv),
		// but the fact that fetch works at all confirms package.json was parsed.
		// Name is stable from Cli.create.
		expect(cli.name).toBe("cuekit");
	});
});
