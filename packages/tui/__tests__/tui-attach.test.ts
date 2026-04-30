import { describe, expect, it } from "bun:test";
import type { TaskStatusView } from "@cuekit/core";
import { buildTmuxAttachArgs, getTmuxSessionName } from "../src/attach.ts";

const baseView: TaskStatusView = {
	task_id: "t_abc",
	agent_kind: "opencode",
	status: "running",
	created_at: "2026-04-30T00:00:00.000Z",
	updated_at: "2026-04-30T00:00:00.000Z",
	supports_attach: true,
};

describe("tui tmux attach helpers", () => {
	it("extracts tmux session from metadata", () => {
		expect(
			getTmuxSessionName({
				...baseView,
				metadata: { tmux_session_name: "cuekit-task-t_abc" },
				attach_hint: "tmux attach-session -t ignored",
			}),
		).toBe("cuekit-task-t_abc");
	});

	it("parses canonical attach hints", () => {
		expect(
			getTmuxSessionName({ ...baseView, attach_hint: "tmux attach-session -t cuekit-task-t_abc" }),
		).toBe("cuekit-task-t_abc");
		expect(
			getTmuxSessionName({ ...baseView, attach_hint: "tmux attach -t cuekit-task-t_abc" }),
		).toBe("cuekit-task-t_abc");
	});

	it("rejects malformed and non-tmux attach hints", () => {
		expect(getTmuxSessionName({ ...baseView, attach_hint: "echo nope" })).toBeNull();
		expect(getTmuxSessionName({ ...baseView, attach_hint: "tmux list-sessions" })).toBeNull();
		expect(getTmuxSessionName({ ...baseView, attach_hint: "tmux attach-session" })).toBeNull();
	});

	it("builds shell-free tmux attach argv with mouse scrolling enabled", () => {
		expect(buildTmuxAttachArgs("cuekit-task-t_abc")).toEqual([
			"tmux",
			"set-option",
			"-t",
			"cuekit-task-t_abc",
			"mouse",
			"on",
			";",
			"attach-session",
			"-t",
			"cuekit-task-t_abc",
		]);
	});
});
