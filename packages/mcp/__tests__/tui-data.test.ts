import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, createClaudeCodeAdapter, PaneBackend } from "@cuekit/adapters";
import { FakeTmuxRunner } from "@cuekit/adapters/testing";
import {
	appendTaskEvent,
	runMigrations,
	updateTaskChildTokenHash,
	updateTaskRefs,
} from "@cuekit/store";
import type { CommandContext } from "../src/command-context.ts";
import { runSubmitTask } from "../src/commands/submit-task.ts";
import { loadTaskDetail, loadTaskList, readTranscriptTail } from "../src/tui/data.ts";

function makeCtx(): CommandContext {
	const db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	const panes = new PaneBackend({ runner: new FakeTmuxRunner(), sendKeysDelayMs: 0 });
	const registry = new AdapterRegistry();
	registry.register(
		createClaudeCodeAdapter(db, panes, {
			launchCommandOverride: () => "sleep 60",
		}),
	);
	return { db, registry };
}

async function submitTask(ctx: CommandContext) {
	const submitted = await runSubmitTask(ctx, {
		objective: "x",
		agent_kind: "claude-code",
		cwd: "/tmp/cuekit-tui-data",
	});
	if (!submitted.accepted) throw new Error("setup failed");
	return submitted;
}

describe("tui data helpers", () => {
	it("loads an empty task list", async () => {
		const ctx = makeCtx();
		const list = await loadTaskList(ctx, { limit: 100 });

		expect("tasks" in list).toBe(true);
		if ("tasks" in list) {
			expect(list.tasks).toEqual([]);
			expect(list.has_more).toBe(false);
		}
	});

	it("loads submitted tasks for the cockpit list", async () => {
		const ctx = makeCtx();
		const submitted = await submitTask(ctx);

		const list = await loadTaskList(ctx, { limit: 100 });

		expect("tasks" in list).toBe(true);
		if ("tasks" in list) {
			expect(list.tasks.map((task) => task.task_id)).toContain(submitted.task_id);
		}
	});

	it("loads selected task status and events", async () => {
		const ctx = makeCtx();
		const submitted = await submitTask(ctx);
		updateTaskChildTokenHash(
			ctx.db,
			submitted.task_id,
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);
		appendTaskEvent(ctx.db, {
			id: "e_halfway",
			task_id: submitted.task_id,
			type: "progress",
			message: "halfway",
			payload: null,
		});

		const detail = await loadTaskDetail(ctx, submitted.task_id);

		expect(detail.status.task_id).toBe(submitted.task_id);
		expect(detail.events).toHaveLength(1);
		expect(detail.events[0]?.message).toBe("halfway");
	});

	it("reads the last N transcript lines", () => {
		const dir = mkdtempSync(`${tmpdir()}/cuekit-tui-transcript-`);
		try {
			const path = join(dir, "transcript.txt");
			writeFileSync(path, "one\ntwo\nthree\nfour\n");

			expect(readTranscriptTail(path, 2)).toEqual(["three", "four"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("tolerates missing transcript files", () => {
		expect(readTranscriptTail("/definitely/missing/transcript.txt", 10)).toEqual([]);
		expect(readTranscriptTail(undefined, 10)).toEqual([]);
	});

	it("loads transcript tail from selected task transcript_ref when present", async () => {
		const ctx = makeCtx();
		const submitted = await submitTask(ctx);
		const dir = mkdtempSync(`${tmpdir()}/cuekit-tui-transcript-ref-`);
		try {
			mkdirSync(join(dir, "nested"));
			const transcriptPath = join(dir, "nested", "transcript.txt");
			writeFileSync(transcriptPath, "alpha\nbeta\ngamma\n");
			updateTaskRefs(ctx.db, submitted.task_id, { transcript_ref: transcriptPath });

			const detail = await loadTaskDetail(ctx, submitted.task_id, { transcriptLines: 2 });

			expect(detail.transcriptPath).toBe(transcriptPath);
			expect(detail.transcriptTail).toEqual(["beta", "gamma"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
