import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	createSession,
	createTask,
	createTaskTeam,
	listTeamEvents,
	runMigrations,
	updateTaskChildTokenHash,
} from "@cuekit/store";

// Full stack test: spawn `bun packages/mcp/src/bin.ts --mcp` as a real child
// process and speak the MCP JSON-RPC protocol to it over stdin/stdout. This
// is the only test that exercises `cuekit --mcp`'s actual wire protocol —
// unit tests of individual command functions mock everything.
//
// Uses an isolated tmpdir DB via CUEKIT_DB_PATH so test runs don't pollute
// ~/.cuekit/state.db and can be torn down cleanly.

// Resolve the workspace root from this test file's location so the test
// works regardless of where `bun test` is invoked from (local dev, CI,
// other contributors' machines).
//   packages/mcp/__tests__/mcp-stdio-integ.test.ts → up 3 levels
const WORKSPACE_ROOT = resolve(import.meta.dir, "..", "..", "..");

const READ_TIMEOUT_MS = 10_000;
const SIGKILL_GRACE_MS = 500;
const DATA_TOKEN_HASH = "sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7";

type JsonRpcMessage = Record<string, unknown>;

interface SpawnedServer {
	proc: ReturnType<typeof Bun.spawn>;
	send(msg: JsonRpcMessage): Promise<void>;
	readNext(context?: string): Promise<JsonRpcMessage>;
	getStderr(): string;
	shutdown(): Promise<void>;
}

async function spawnServer(dbPath: string): Promise<SpawnedServer> {
	const proc = Bun.spawn(["bun", "packages/mcp/src/bin.ts", "--mcp"], {
		cwd: WORKSPACE_ROOT,
		env: { ...process.env, CUEKIT_DB_PATH: dbPath },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const reader = proc.stdout.getReader();
	let buffer = "";

	// Collect stderr in the background so it's available for diagnostics
	// when a test times out or fails unexpectedly.
	const stderrChunks: string[] = [];
	const stderrReader = proc.stderr.getReader();
	const stderrPump = (async () => {
		try {
			while (true) {
				const { done, value } = await stderrReader.read();
				if (done) return;
				stderrChunks.push(decoder.decode(value));
			}
		} catch {
			// stream closed during shutdown — ignore
		}
	})();

	function getStderr(): string {
		return stderrChunks.join("");
	}

	async function readLoop(): Promise<JsonRpcMessage> {
		// MCP stdio transport is newline-delimited JSON — one message per line.
		while (true) {
			const nl = buffer.indexOf("\n");
			if (nl >= 0) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				if (line.length > 0) {
					return JSON.parse(line) as JsonRpcMessage;
				}
				continue;
			}
			const { done, value } = await reader.read();
			if (done) throw new Error("cuekit --mcp stream closed before reply");
			buffer += decoder.decode(value);
		}
	}

	async function readNext(context?: string): Promise<JsonRpcMessage> {
		// Guard against hung subprocesses: if the server never replies within
		// READ_TIMEOUT_MS, fail with a clear message + last-500-chars of
		// stderr so the test author knows what the child logged.
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				const ctx = context ? ` (awaiting ${context})` : "";
				const stderrTail = getStderr().slice(-500);
				reject(
					new Error(
						`readNext timed out after ${READ_TIMEOUT_MS}ms${ctx}. Last stderr:\n${stderrTail}`,
					),
				);
			}, READ_TIMEOUT_MS);
		});
		try {
			return await Promise.race([readLoop(), timeoutPromise]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}

	async function send(msg: JsonRpcMessage): Promise<void> {
		// Bun.spawn's stdin is a FileSink, not a WritableStream.
		proc.stdin.write(encoder.encode(`${JSON.stringify(msg)}\n`));
		await proc.stdin.flush();
	}

	async function shutdown(): Promise<void> {
		try {
			reader.releaseLock();
		} catch {
			// reader may already be done
		}
		proc.kill();
		// If SIGTERM doesn't unblock the child, escalate to SIGKILL so the
		// test suite doesn't hang.
		const hardKill = setTimeout(() => {
			try {
				proc.kill("SIGKILL");
			} catch {
				// already dead
			}
		}, SIGKILL_GRACE_MS);
		try {
			await proc.exited;
		} finally {
			clearTimeout(hardKill);
			await stderrPump;
		}
	}

	return { proc, send, readNext, getStderr, shutdown };
}

async function initialize(server: SpawnedServer): Promise<JsonRpcMessage> {
	await server.send({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "cuekit-integ-test", version: "0.0.0" },
		},
	});
	const reply = await server.readNext("initialize reply");
	// Initialized notification (no reply expected)
	await server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
	return reply;
}

interface ToolCallResult {
	content?: Array<{ type: string; text?: string }>;
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
}

// Extract the tool-call's data payload — incur emits `structuredContent`
// for schema-typed reads and also inlines the JSON text in `content[0]`.
function toolCallData(result: ToolCallResult): Record<string, unknown> {
	if (result.structuredContent) return result.structuredContent;
	const text = result.content?.[0]?.text ?? "{}";
	return JSON.parse(text) as Record<string, unknown>;
}

function seedReportableTask(path: string): void {
	const db = new Database(path);
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	createSession(db, {
		id: "s_mcp",
		project_root: tmpRoot,
		worktree_path: tmpRoot,
		parent_agent_kind: "cuekit-cli",
	});
	createTask(db, {
		id: "t_mcp",
		session_id: "s_mcp",
		agent_kind: "claude-code",
		objective: "report through mcp",
		status: "running",
	});
	updateTaskChildTokenHash(db, "t_mcp", DATA_TOKEN_HASH);
	db.close();
}

function seedTeam(path: string): void {
	const db = new Database(path);
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	createSession(db, {
		id: "s_team_mcp",
		project_root: tmpRoot,
		worktree_path: tmpRoot,
		parent_agent_kind: "cuekit-cli",
	});
	createTaskTeam(db, {
		id: "tm_mcp",
		session_id: "s_team_mcp",
		title: "MCP team",
	});
	db.close();
}

let tmpRoot: string;
let dbPath: string;
let server: SpawnedServer;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "cuekit-mcp-integ-"));
	dbPath = join(tmpRoot, "state.db");
	server = await spawnServer(dbPath);
});

afterEach(async () => {
	await server.shutdown();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("cuekit --mcp (stdio integration)", () => {
	it("completes the initialize handshake and reports server info", async () => {
		const init = await initialize(server);
		expect(init.jsonrpc).toBe("2.0");
		expect(init.id).toBe(1);
		const result = init.result as Record<string, unknown> | undefined;
		expect(result).toBeDefined();
		expect(result?.serverInfo).toBeDefined();
	});

	it("tools/list returns cuekit commands as MCP tools", async () => {
		await initialize(server);
		await server.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
		const reply = await server.readNext("tools/list reply");
		const result = reply.result as {
			tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
		};
		const names = result.tools.map((t) => t.name).sort();
		expect(names).toEqual([
			"cancel_tasks",
			"cleanup",
			"create_team",
			"delete",
			"get_status",
			"get_task_result",
			"get_task_snapshot",
			"get_team_result",
			"get_team_snapshot",
			"list",
			"report",
			"report_task_event",
			"start_team_strategy",
			"steer",
			"steer_task",
			"steer_team",
			"submit_task",
			"submit_team_tasks",
			"wait",
		]);
		expect(names).not.toContain("show_mcp_config");
		expect(names).not.toContain("list_adapters");
		expect(names).not.toContain("list_tasks");
		const listTool = result.tools.find((tool) => tool.name === "list");
		expect(listTool?.inputSchema?.properties).toHaveProperty("strategy");
		expect(listTool?.inputSchema?.properties).toHaveProperty("include_prompt");
		expect(listTool?.inputSchema?.properties).toHaveProperty("objective");
	});

	it("tools/call list kind=adapters returns the registered MVP adapters", async () => {
		await initialize(server);
		await server.send({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "list", arguments: { kind: "adapters" } },
		});
		const reply = await server.readNext("list adapters reply");
		const result = reply.result as ToolCallResult;
		const text = result.content?.[0]?.text ?? "{}";
		expect(text).toContain("agent_kind");
		const textPayload = JSON.parse(text) as { adapters: Array<{ agent_kind: string }> };
		const adapters = textPayload.adapters;
		const kinds = adapters.map((a) => a.agent_kind).sort();
		expect(kinds).toEqual(["claude-code", "gemini", "jcode", "opencode", "pi"]);
	});

	it("tools/call list kind=strategies returns project team strategies", async () => {
		writeFileSync(
			join(tmpRoot, ".cuekit.yaml"),
			`strategies:
  feature:
    description: Feature work
    checks:
      - bun test
`,
		);
		await initialize(server);
		await server.send({
			jsonrpc: "2.0",
			id: 33,
			method: "tools/call",
			params: { name: "list", arguments: { kind: "strategies", cwd: tmpRoot } },
		});
		const reply = await server.readNext("list strategies reply");
		const result = reply.result as ToolCallResult;
		const data = toolCallData(result) as {
			strategies?: Array<{ name: string; description?: string; checks?: string[] }>;
		};
		expect(data.strategies).toEqual([
			{ name: "feature", description: "Feature work", checks: ["bun test"] },
		]);
	});

	it("tools/call submit_task returns a structured response (happy OR submit_failed)", async () => {
		// End-to-end wire test: the MCP envelope + tool input/output shape is
		// what we care about here. Use a deliberately missing adapter so the
		// server returns the structured `accepted: false` shape without launching
		// a real tmux/zellij/herdr pane. This keeps stdio protocol coverage from
		// leaking multiplexer workspaces when the project config points at a real
		// backend such as Herdr.
		await initialize(server);
		await server.send({
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: {
				name: "submit_task",
				arguments: {
					objective: "stdio integ test",
					agent_kind: "missing-adapter-for-stdio-test",
					cwd: tmpRoot,
				},
			},
		});
		const reply = await server.readNext("submit_task reply");
		const data = toolCallData(reply.result as ToolCallResult) as {
			accepted?: boolean;
			task_id?: string;
			error?: { code: string };
		};
		expect(data).toHaveProperty("accepted");
		expect(typeof data.accepted).toBe("boolean");
		if (data.accepted === false) {
			expect(data.error?.code).toBeDefined();
		} else {
			expect(data.task_id).toMatch(/^t_/);
		}
	});

	it("tools/call report_task_event and list_task_events persist child reports", async () => {
		await server.shutdown();
		seedReportableTask(dbPath);
		server = await spawnServer(dbPath);
		await initialize(server);

		await server.send({
			jsonrpc: "2.0",
			id: 5,
			method: "tools/call",
			params: {
				name: "report_task_event",
				arguments: {
					task_id: "t_mcp",
					child_token: "data",
					type: "progress",
					message: "Working over MCP",
				},
			},
		});
		const progressReply = await server.readNext("report_task_event progress reply");
		const progressData = toolCallData(progressReply.result as ToolCallResult) as { ok?: boolean };
		expect(progressData.ok).toBe(true);

		await server.send({
			jsonrpc: "2.0",
			id: 6,
			method: "tools/call",
			params: {
				name: "report_task_event",
				arguments: {
					task_id: "t_mcp",
					child_token: "data",
					type: "completed",
					message: "Done over MCP",
				},
			},
		});
		const reportReply = await server.readNext("report_task_event reply");
		const reportData = toolCallData(reportReply.result as ToolCallResult) as { ok?: boolean };
		expect(reportData.ok).toBe(true);

		await server.send({
			jsonrpc: "2.0",
			id: 7,
			method: "tools/call",
			params: {
				name: "get_status",
				arguments: { kind: "task", task_id: "t_mcp" },
			},
		});
		const statusReply = await server.readNext("get_status reply");
		const statusResult = statusReply.result as ToolCallResult;
		const statusData = JSON.parse(statusResult.content?.[0]?.text ?? "{}") as { status?: string };
		expect(statusData.status).toBe("completed");

		await server.send({
			jsonrpc: "2.0",
			id: 8,
			method: "tools/call",
			params: {
				name: "list",
				arguments: { kind: "events", task_id: "t_mcp" },
			},
		});
		const listReply = await server.readNext("list events reply");
		const listResult = listReply.result as ToolCallResult;
		const listData = JSON.parse(listResult.content?.[0]?.text ?? "{}") as {
			events?: Array<{ type: string; message: string | null }>;
		};
		expect(listData.events).toEqual([
			expect.objectContaining({ type: "progress", message: "Working over MCP" }),
			expect.objectContaining({ type: "completed", message: "Done over MCP" }),
		]);
	});

	it("tools/call with an unknown tool name surfaces an error", async () => {
		await initialize(server);
		await server.send({
			jsonrpc: "2.0",
			id: 5,
			method: "tools/call",
			params: { name: "no_such_tool", arguments: {} },
		});
		const reply = await server.readNext("unknown-tool reply");
		// Either a JSON-RPC error object OR an MCP tool-result with isError.
		const hasJsonRpcError = reply.error !== undefined;
		const result = reply.result as ToolCallResult | undefined;
		const hasToolError = result?.isError === true;
		expect(hasJsonRpcError || hasToolError).toBe(true);
	});

	it("tools/call report kind=team_event persists a team blackboard event", async () => {
		await server.shutdown();
		seedTeam(dbPath);
		server = await spawnServer(dbPath);
		await initialize(server);

		await server.send({
			jsonrpc: "2.0",
			id: 9,
			method: "tools/call",
			params: {
				name: "report",
				arguments: {
					kind: "team_event",
					team_id: "tm_mcp",
					event_type: "decision",
					message: "Use the grouped team event surface.",
					payload: { source: "mcp-test" },
				},
			},
		});
		const reply = await server.readNext("report team_event reply");
		const data = toolCallData(reply.result as ToolCallResult) as {
			ok?: boolean;
			team_id?: string;
			event_id?: string;
		};
		expect(data.ok).toBe(true);
		expect(data.team_id).toBe("tm_mcp");
		expect(data.event_id).toMatch(/^te_/);

		const db = new Database(dbPath);
		try {
			const events = listTeamEvents(db, "tm_mcp");
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				team_id: "tm_mcp",
				event_type: "decision",
				message: "Use the grouped team event surface.",
				payload_json: JSON.stringify({ source: "mcp-test" }),
			});
		} finally {
			db.close();
		}
	});
});
