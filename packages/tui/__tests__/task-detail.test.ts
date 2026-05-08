import { describe, expect, it } from "bun:test";
import type { TaskSummary } from "@cuekit/core";
import {
	attentionEntries,
	contextHeight,
	metadataEntries,
	padLinesForLiveOutput,
} from "../src/components/task-detail.tsx";
import type { TuiTaskDetail } from "../src/data.ts";

describe("TaskDetail contextHeight", () => {
	it("gives metadata and recent events enough room before transcript output", () => {
		const metadata = [
			{ label: "updated", value: "12:00:00" },
			{ label: "role", value: "docs-writer (builtin)" },
			{ label: "model", value: "haiku" },
			{ label: "transcript", value: ".cuekit/tasks/t_1/transcript.txt" },
		];
		const events = [
			{
				sequence: 89,
				id: "e1",
				task_id: "t_1",
				type: "progress",
				message: "Working",
				payload: null,
				created_at: "2026-05-01T00:00:00.000Z",
			},
			{
				sequence: 90,
				id: "e2",
				task_id: "t_1",
				type: "completed",
				message: "Completed with a long summary",
				payload: null,
				created_at: "2026-05-01T00:00:01.000Z",
			},
		];

		expect(contextHeight(metadata, events)).toBe(9);
	});

	it("caps context height so transcript output still has room", () => {
		const metadata = Array.from({ length: 8 }, (_, index) => ({
			label: `m${index}`,
			value: "value",
		}));
		const events = Array.from({ length: 4 }, (_, index) => ({
			sequence: index + 1,
			id: `e${index}`,
			task_id: "t_1",
			type: "progress",
			message: "x",
			payload: null,
			created_at: "2026-05-01T00:00:00.000Z",
		}));

		expect(contextHeight(metadata, events)).toBe(12);
	});

	it("accounts for attention rows when sizing the context panel", () => {
		const metadata = [
			{ label: "updated", value: "12:00:00" },
			{ label: "team", value: "tm_1" },
		];
		const events = [
			{
				sequence: 1,
				id: "e1",
				task_id: "t_1",
				type: "completed",
				message: "done",
				payload: null,
				created_at: "2026-05-01T00:00:00.000Z",
			},
		];
		const attention = [{ sequence: 1, type: "completed", message: "done" }];

		expect(contextHeight(metadata, events, attention)).toBe(7);
	});

	it("derives task detail attention entries from important non-coordinator events", () => {
		const detail: TuiTaskDetail = {
			status: {
				task_id: "t_1",
				agent_kind: "claude-code",
				status: "blocked",
				position: "worker",
				created_at: "2026-05-01T00:00:00.000Z",
				updated_at: "2026-05-01T00:00:00.000Z",
			},
			events: [
				{
					sequence: 1,
					id: "e1",
					task_id: "t_1",
					type: "progress",
					message: "working",
					payload: null,
					created_at: "2026-05-01T00:00:00.000Z",
				},
				{
					sequence: 2,
					id: "e2",
					task_id: "t_1",
					type: "help_requested",
					message: "need input",
					payload: null,
					created_at: "2026-05-01T00:00:01.000Z",
				},
			],
			transcriptTail: [],
			transcriptSource: "file",
		};

		expect(attentionEntries(detail)).toEqual([
			expect.objectContaining({ sequence: 2, type: "help_requested", message: "need input" }),
		]);
	});

	it("prefers team run summary attention items and marks manual steer hints", () => {
		const detail: TuiTaskDetail = {
			status: {
				task_id: "t_coord",
				agent_kind: "pi",
				status: "running",
				position: "coordinator",
				team_id: "tm_1",
				created_at: "2026-05-01T00:00:00.000Z",
				updated_at: "2026-05-01T00:00:00.000Z",
			},
			events: [],
			teamAttentionItems: [
				{
					sequence: 7,
					task_id: "t_worker",
					position: "worker",
					type: "blocked",
					message_preview: "needs context",
					created_at: "2026-05-01T00:00:01.000Z",
				},
			],
			manualSteerHints: [
				{
					attention_sequence: 7,
					task_id: "t_worker",
					position: "worker",
					tool: "steer_task",
					suggested_message: "Please continue",
					rationale: "Manual helper only",
				},
			],
			transcriptTail: [],
			transcriptSource: "file",
		};

		expect(attentionEntries(detail)).toEqual([
			expect.objectContaining({
				sequence: 7,
				type: "blocked",
				message: "worker: needs context ↪ steer hint",
			}),
		]);
	});

	it("surfaces team status load errors in the attention panel", () => {
		const detail: TuiTaskDetail = {
			status: {
				task_id: "t_coord",
				agent_kind: "pi",
				status: "running",
				position: "coordinator",
				team_id: "tm_1",
				created_at: "2026-05-01T00:00:00.000Z",
				updated_at: "2026-05-01T00:00:00.000Z",
			},
			events: [],
			teamStatusError: "team unavailable",
			transcriptTail: [],
			transcriptSource: "file",
		};

		expect(attentionEntries(detail)).toEqual([
			expect.objectContaining({
				type: "team_status",
				message: "team status error: team unavailable",
			}),
		]);
	});

	it("does not show coordinator terminal reports as task detail attention entries", () => {
		const detail: TuiTaskDetail = {
			status: {
				task_id: "t_coord",
				agent_kind: "pi",
				status: "completed",
				position: "coordinator",
				created_at: "2026-05-01T00:00:00.000Z",
				updated_at: "2026-05-01T00:00:00.000Z",
			},
			events: [
				{
					sequence: 1,
					id: "e1",
					task_id: "t_coord",
					type: "completed",
					message: "final summary",
					payload: null,
					created_at: "2026-05-01T00:00:00.000Z",
				},
			],
			transcriptTail: [],
			transcriptSource: "file",
		};

		expect(attentionEntries(detail)).toEqual([]);
	});

	it("shows team status load errors in task metadata", () => {
		const task: TaskSummary = {
			task_id: "t_1",
			agent_kind: "claude-code",
			status: "running",
			team_id: "tm_1",
			updated_at: "2026-05-01T00:00:00.000Z",
		};
		const detail: TuiTaskDetail = {
			status: {
				task_id: "t_1",
				agent_kind: "claude-code",
				status: "running",
				team_id: "tm_1",
				created_at: "2026-05-01T00:00:00.000Z",
				updated_at: "2026-05-01T00:00:00.000Z",
			},
			events: [],
			teamStatusError: "team status failed",
			transcriptTail: [],
			transcriptSource: "file",
		};

		expect(metadataEntries(task, detail)).toContainEqual(
			expect.objectContaining({ label: "team status", value: "team status failed" }),
		);
	});

	it("omits attach metadata when a batch status exposes no attach hint", () => {
		const task: TaskSummary = {
			task_id: "t_1",
			agent_kind: "claude-code",
			status: "running",
			updated_at: "2026-05-01T00:00:00.000Z",
		};
		const detail: TuiTaskDetail = {
			status: {
				task_id: "t_1",
				agent_kind: "claude-code",
				status: "running",
				created_at: "2026-05-01T00:00:00.000Z",
				updated_at: "2026-05-01T00:00:00.000Z",
				supports_attach: false,
				attach_hint: "tmux attach-session -t cuekit-task-t_1",
				metadata: { adapter_mode: "batch", tmux_session_name: "cuekit-task-t_1" },
			},
			events: [],
			transcriptTail: [],
			transcriptSource: "file",
		};

		expect(metadataEntries(task, detail).map((entry) => entry.label)).not.toContain("attach");
	});
});

describe("padLinesForLiveOutput", () => {
	it("pads short input with a head marker followed by empty lines so newest content stays at bottom", () => {
		const out = padLinesForLiveOutput(["alpha", "beta"], 5);

		// First padded line is the "no earlier content" anchor; remaining
		// padding stays empty so the visual weight is low; content
		// lands at the bottom for sticky-scroll compatibility.
		expect(out[0]).toContain("no earlier pane content");
		expect(out.slice(1, 3)).toEqual(["", ""]);
		expect(out.slice(-2)).toEqual(["alpha", "beta"]);
		expect(out).toHaveLength(5);
	});

	it("places the head marker even when only one padding slot exists", () => {
		const out = padLinesForLiveOutput(["a", "b"], 3);

		expect(out[0]).toContain("no earlier pane content");
		expect(out.slice(-2)).toEqual(["a", "b"]);
	});

	it("returns the input unchanged when length already matches the target", () => {
		const out = padLinesForLiveOutput(["a", "b", "c"], 3);

		expect(out).toEqual(["a", "b", "c"]);
	});

	it("trims to the last `target` lines when input is longer than target", () => {
		const out = padLinesForLiveOutput(["a", "b", "c", "d", "e"], 3);

		expect(out).toEqual(["c", "d", "e"]);
	});

	it("returns the input untouched for a non-positive target", () => {
		expect(padLinesForLiveOutput(["a", "b"], 0)).toEqual(["a", "b"]);
		expect(padLinesForLiveOutput(["a", "b"], -1)).toEqual(["a", "b"]);
	});
});
