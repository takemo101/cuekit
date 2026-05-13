import { describe, expect, it } from "bun:test";
import type { TaskSummary } from "@cuekit/core";
import {
	attentionEntries,
	contextHeight,
	metadataEntries,
	padLinesForLiveOutput,
	TaskDetail,
} from "../src/components/task-detail.tsx";
import { TeamDetail } from "../src/components/team-detail.tsx";
import type { TuiTaskDetail } from "../src/data.ts";

describe("TaskDetail contextHeight", () => {
	it("shows a loading marker while delayed detail data is pending", () => {
		const source = TaskDetail({
			task: {
				task_id: "t_loading",
				agent_kind: "pi",
				status: "running",
				updated_at: "2026-05-10T00:00:00.000Z",
			},
			loadingDetail: true,
		});

		expect(JSON.stringify(source)).toContain("Loading detail");
	});

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
					tool: "steer" as const,
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

	it("renders compact team snapshot and blackboard sections", () => {
		const team = {
			team_id: "tm_1",
			session_id: "s_1",
			title: "Team",
			status: "running" as const,
			task_counts: {
				total: 1,
				queued: 0,
				running: 1,
				input_required: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
				timed_out: 0,
				blocked: 0,
			},
			created_at: "2026-05-01T00:00:00.000Z",
			updated_at: "2026-05-01T00:00:00.000Z",
		};
		const detail = {
			team,
			members: [],
			lanes: {},
			attentionItems: [
				{
					sequence: 1,
					task_id: "t_worker",
					position: "worker",
					type: "help_requested" as const,
					message_preview: "Need API input",
					created_at: "2026-05-01T00:00:00.000Z",
				},
			],
			manualSteerHints: [
				{
					attention_sequence: 1,
					task_id: "t_worker",
					position: "worker",
					tool: "steer" as const,
					suggested_message: "Please inspect API",
					rationale: "Worker is blocked",
				},
			],
			blockers: [{ task_id: "t_worker", position: "worker", message: "Waiting on API" }],
			latestHandoffs: [
				{
					task_id: "t_worker",
					position: "worker",
					event_id: "e_1",
					sequence: 2,
					message_preview: "Continue from handoff",
					created_at: "2026-05-01T00:00:00.000Z",
				},
			],
			blackboardEvents: [
				{
					sequence: 3,
					event_id: "te_1",
					event_type: "finding" as const,
					position: "worker",
					message: "Found shared constraint",
					created_at: "2026-05-01T00:00:00.000Z",
				},
			],
		};
		const overview = JSON.stringify(
			TeamDetail({ team, detail, selectedMemberIndex: 0, focus: "list", activeTab: "overview" }),
		);
		expect(overview).toContain("Tasks: 1 running / 0 blocked / 0 completed");
		expect(overview).toContain("Attention: 1");
		expect(overview).toContain("Blockers: 1");
		expect(overview).toContain("Handoffs: 1");
		expect(overview).toContain("Blackboard: 1");
		expect(overview).toContain("Next: inspect blocker t_worker");

		const attention = JSON.stringify(
			TeamDetail({ team, detail, selectedMemberIndex: 0, focus: "list", activeTab: "attention" }),
		);
		expect(attention).toContain("BLOCKERS 1");
		expect(attention).toContain("Waiting on API");
		expect(attention).toContain("ATTENTION 1");
		expect(attention).toContain("Need API input");
		expect(attention).toContain("STEER HINTS 1");
		expect(attention).toContain("Please inspect API");

		const knowledge = JSON.stringify(
			TeamDetail({ team, detail, selectedMemberIndex: 0, focus: "list", activeTab: "knowledge" }),
		);
		expect(knowledge).toContain("HANDOFFS 1");
		expect(knowledge).toContain("Continue from handoff");
		expect(knowledge).toContain("BLACKBOARD 1");
		expect(knowledge).toContain("finding");
		expect(knowledge).toContain("Found shared constraint");
	});

	it("renders team members tab with lane and selected member context", () => {
		const team = {
			team_id: "tm_1",
			session_id: "s_1",
			title: "Team",
			status: "running" as const,
			task_counts: {
				total: 1,
				queued: 0,
				running: 1,
				input_required: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
				timed_out: 0,
				blocked: 0,
			},
			created_at: "2026-05-01T00:00:00.000Z",
			updated_at: "2026-05-01T00:00:00.000Z",
		};
		const member = {
			task_id: "t_worker",
			agent_kind: "claude-code" as const,
			status: "running" as const,
			position: "worker" as const,
			role: "builder",
			updated_at: "2026-05-01T00:00:00.000Z",
		};
		const source = TeamDetail({
			team,
			detail: { team, members: [member], lanes: { worker: [member] } },
			selectedMemberIndex: 0,
			focus: "members",
			activeTab: "members",
		});
		const rendered = JSON.stringify(source);
		expect(rendered).toContain("LANES");
		expect(rendered).toContain("worker");
		expect(rendered).toContain("MEMBERS");
		expect(rendered).toContain("›");
		expect(rendered).toContain("builder");
	});

	it("renders compact empty states for empty team tabs", () => {
		const team = {
			team_id: "tm_empty",
			session_id: "s_1",
			title: "Empty",
			status: "running" as const,
			task_counts: {
				total: 0,
				queued: 0,
				running: 0,
				input_required: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
				timed_out: 0,
				blocked: 0,
			},
			created_at: "2026-05-01T00:00:00.000Z",
			updated_at: "2026-05-01T00:00:00.000Z",
		};
		const detail = { team, members: [], lanes: {} };
		expect(
			JSON.stringify(
				TeamDetail({ team, detail, selectedMemberIndex: 0, focus: "list", activeTab: "attention" }),
			),
		).toContain("No blockers.");
		expect(
			JSON.stringify(
				TeamDetail({ team, detail, selectedMemberIndex: 0, focus: "list", activeTab: "knowledge" }),
			),
		).toContain("No blackboard events.");
	});

	it("shows backend mismatch metadata with attach-only guidance", () => {
		const task: TaskSummary = {
			task_id: "t_1",
			agent_kind: "pi",
			status: "running",
			updated_at: "2026-05-01T00:00:00.000Z",
		};
		const detail: TuiTaskDetail = {
			status: {
				task_id: "t_1",
				agent_kind: "pi",
				status: "running",
				created_at: "2026-05-01T00:00:00.000Z",
				updated_at: "2026-05-01T00:00:00.000Z",
				metadata: { pane_backend_kind: "zellij", pane_backend_mismatch: true },
			},
			events: [],
			transcriptTail: [],
			transcriptSource: "file",
		};

		expect(metadataEntries(task, detail)).toContainEqual(
			expect.objectContaining({ label: "backend", value: "zellij (config mismatch; attach only)" }),
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
