import { describe, expect, it } from "bun:test";
import type { TaskStatusView, TaskSummary } from "@cuekit/core";
import { metadataEntries } from "../src/components/task-detail.tsx";
import { taskRow } from "../src/components/task-list.tsx";
import type { TuiTaskDetail } from "../src/data.ts";

const updated_at = "2026-05-01T00:00:00.000Z";

const task: TaskSummary = {
	task_id: "t_team_task",
	agent_kind: "claude-code",
	status: "running",
	team_id: "tm_alpha123456",
	position: "worker",
	updated_at,
};

describe("TUI task metadata", () => {
	it("shows compact team metadata in task rows", () => {
		expect(taskRow(task, false)).toContain("w@3456");
	});

	it("shows adapter mode metadata in task detail", () => {
		const detail = {
			status: {
				task_id: task.task_id,
				agent_kind: task.agent_kind,
				status: task.status,
				created_at: updated_at,
				updated_at,
				metadata: { adapter_mode: "batch" },
			} satisfies TaskStatusView,
			events: [],
			transcriptTail: [],
			transcriptSource: "file",
		} satisfies TuiTaskDetail;

		const entries = metadataEntries(task, detail);

		expect(entries).toContainEqual({
			label: "mode",
			value: "batch",
			color: expect.any(String),
		});
	});

	it("shows team metadata in task detail", () => {
		const detail = {
			status: {
				task_id: task.task_id,
				agent_kind: task.agent_kind,
				status: task.status,
				team_id: task.team_id,
				position: task.position,
				created_at: updated_at,
				updated_at,
			} satisfies TaskStatusView,
			events: [],
			transcriptTail: [],
			transcriptSource: "file",
		} satisfies TuiTaskDetail;

		const entries = metadataEntries(task, detail);

		expect(entries).toContainEqual({
			label: "team",
			value: "tm_alpha123456",
			color: expect.any(String),
		});
		expect(entries).toContainEqual({
			label: "position",
			value: "worker",
			color: expect.any(String),
		});
	});
});
