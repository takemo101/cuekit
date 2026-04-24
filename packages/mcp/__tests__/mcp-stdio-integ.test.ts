import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Full stack test: spawn `bun packages/mcp/src/bin.ts --mcp` as a real child
// process and speak the MCP JSON-RPC protocol to it over stdin/stdout. This
// is the only test that exercises `cuekit --mcp`'s actual wire protocol —
// unit tests of individual command functions mock everything.
//
// Uses an isolated tmpdir DB via CUEKIT_DB_PATH so test runs don't pollute
// ~/.cuekit/state.db and can be torn down cleanly.

type JsonRpcMessage = Record<string, unknown>;

interface SpawnedServer {
	proc: ReturnType<typeof Bun.spawn>;
	send(msg: JsonRpcMessage): Promise<void>;
	readNext(): Promise<JsonRpcMessage>;
	shutdown(): Promise<void>;
}

async function spawnServer(dbPath: string): Promise<SpawnedServer> {
	const proc = Bun.spawn(["bun", "packages/mcp/src/bin.ts", "--mcp"], {
		cwd: "/Users/kawasakiisao/Desktop/ai/cuekit",
		env: { ...process.env, CUEKIT_DB_PATH: dbPath },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const reader = proc.stdout.getReader();
	let buffer = "";

	async function readNext(): Promise<JsonRpcMessage> {
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
		await proc.exited;
	}

	return { proc, send, readNext, shutdown };
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
	const reply = await server.readNext();
	// Initialized notification (no reply expected)
	await server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
	return reply;
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

	it("tools/list returns the 7 cuekit commands as MCP tools", async () => {
		await initialize(server);
		await server.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
		const reply = await server.readNext();
		const result = reply.result as { tools: Array<{ name: string }> };
		const names = result.tools.map((t) => t.name).sort();
		// incur flattens kebab command names to snake_case for MCP tools.
		expect(names).toContain("submit_task");
		expect(names).toContain("get_task_status");
		expect(names).toContain("get_task_result");
		expect(names).toContain("cancel_task");
		expect(names).toContain("list_tasks");
		expect(names).toContain("list_adapters");
		expect(names).toContain("steer_task");
	});

	it("tools/call list_adapters returns all 3 MVP adapters", async () => {
		await initialize(server);
		await server.send({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "list_adapters", arguments: {} },
		});
		const reply = await server.readNext();
		const result = reply.result as {
			content?: Array<{ type: string; text?: string }>;
			structuredContent?: { adapters: Array<{ agent_kind: string }> };
		};
		// MCP tool results come back as content blocks; incur also emits
		// `structuredContent` alongside for schema-typed reads.
		expect(result).toBeDefined();
		const adapters =
			result.structuredContent?.adapters ??
			(
				JSON.parse(result.content?.[0]?.text ?? "{}") as {
					adapters?: Array<{ agent_kind: string }>;
				}
			).adapters ??
			[];
		const kinds = adapters.map((a) => a.agent_kind).sort();
		expect(kinds).toEqual(["claude-code", "opencode", "pi"]);
	});
});
