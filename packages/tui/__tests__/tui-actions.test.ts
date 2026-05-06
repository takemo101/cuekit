import { describe, expect, it } from "bun:test";
import type { TaskStatus, TaskStatusView } from "@cuekit/core";
import {
	canAttach,
	canCancel,
	canDelete,
	moveSelection,
	resolveEnterTeamFocus,
	resolveEscapeTeamFocus,
	restoreIndexById,
} from "../src/task-actions.ts";

describe("tui task action helpers", () => {
	it("clamps selection movement to task list bounds", () => {
		expect(moveSelection(0, -1, 3)).toBe(0);
		expect(moveSelection(0, 1, 3)).toBe(1);
		expect(moveSelection(2, 1, 3)).toBe(2);
		expect(moveSelection(5, 0, 3)).toBe(2);
		expect(moveSelection(0, 1, 0)).toBe(0);
	});

	it("allows attach when attach support and an attach target are present", () => {
		const withHint: TaskStatusView = {
			task_id: "t_1",
			agent_kind: "opencode",
			status: "running",
			created_at: "2026-04-30T00:00:00.000Z",
			updated_at: "2026-04-30T00:00:00.000Z",
			supports_attach: true,
			attach_hint: "tmux attach-session -t cuekit-task-t_1",
		};
		const withMetadata: TaskStatusView = {
			...withHint,
			attach_hint: undefined,
			metadata: { tmux_session_name: "cuekit-task-t_1" },
		};
		const batchWithMetadata: TaskStatusView = {
			...withMetadata,
			supports_attach: false,
			metadata: { tmux_session_name: "cuekit-task-t_1", adapter_mode: "batch" },
		};

		expect(canAttach(batchWithMetadata)).toBe(false);
		expect(canAttach(withHint)).toBe(true);
		expect(canAttach(withMetadata)).toBe(true);
	});

	it("allows attach for terminal tasks when tmux metadata remains", () => {
		const view: TaskStatusView = {
			task_id: "t_1",
			agent_kind: "opencode",
			status: "completed",
			created_at: "2026-04-30T00:00:00.000Z",
			updated_at: "2026-04-30T00:00:00.000Z",
			supports_attach: true,
			metadata: { tmux_session_name: "cuekit-task-t_1" },
		};

		expect(canAttach(view)).toBe(true);
	});

	it("rejects attach for terminal tasks whose session is explicitly killed", () => {
		const cancelled: TaskStatusView = {
			task_id: "t_1",
			agent_kind: "opencode",
			status: "cancelled",
			created_at: "2026-04-30T00:00:00.000Z",
			updated_at: "2026-04-30T00:00:00.000Z",
			supports_attach: true,
			metadata: { tmux_session_name: "cuekit-task-t_1" },
		};
		const timedOut: TaskStatusView = { ...cancelled, status: "timed_out" };

		expect(canAttach(cancelled)).toBe(false);
		expect(canAttach(timedOut)).toBe(false);
	});

	it("rejects attach when support or attach target is missing", () => {
		const base: TaskStatusView = {
			task_id: "t_1",
			agent_kind: "opencode",
			status: "running",
			created_at: "2026-04-30T00:00:00.000Z",
			updated_at: "2026-04-30T00:00:00.000Z",
			supports_attach: true,
		};

		expect(canAttach(base)).toBe(false);
		expect(
			canAttach({ ...base, supports_attach: false, attach_hint: "tmux attach-session -t x" }),
		).toBe(false);
	});

	it("allows cancel only for non-terminal task statuses", () => {
		const terminal: TaskStatus[] = ["completed", "failed", "cancelled", "timed_out", "blocked"];
		const nonTerminal: TaskStatus[] = ["queued", "running", "input_required"];

		for (const status of terminal) expect(canCancel(status)).toBe(false);
		for (const status of nonTerminal) expect(canCancel(status)).toBe(true);
	});

	it("allows delete only for terminal task statuses", () => {
		const terminal: TaskStatus[] = ["completed", "failed", "cancelled", "timed_out", "blocked"];
		const nonTerminal: TaskStatus[] = ["queued", "running", "input_required"];

		for (const status of terminal) expect(canDelete(status)).toBe(true);
		for (const status of nonTerminal) expect(canDelete(status)).toBe(false);
	});

	it("restores selections by id and falls back to bounded index", () => {
		const rows = [{ id: "a" }, { id: "b" }];

		expect(restoreIndexById(rows, "b", 0, (row) => row.id)).toBe(1);
		expect(restoreIndexById(rows, "missing", 5, (row) => row.id)).toBe(1);
		expect(restoreIndexById(rows, undefined, -5, (row) => row.id)).toBe(0);
		expect(restoreIndexById<{ id: string }>([], "missing", 5, (row) => row.id)).toBe(0);
	});

	it("moves team focus only when member tasks exist", () => {
		expect(resolveEnterTeamFocus("list", 1)).toBe("members");
		expect(resolveEnterTeamFocus("list", 0)).toBe("list");
		expect(resolveEnterTeamFocus("members", 1)).toBe("members");
		expect(resolveEscapeTeamFocus("members")).toBe("list");
		expect(resolveEscapeTeamFocus("list")).toBe("list");
	});
});
