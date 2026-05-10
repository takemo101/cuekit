import { describe, expect, it } from "bun:test";
import type { TaskStatusView } from "@cuekit/core";
import {
	buildTmuxAttachArgs,
	buildTuiTaskAttachExit,
	getPaneAttachCommand,
	getTmuxSessionName,
} from "../src/attach.ts";

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

	it("builds task attach exits with return state for attach-and-return", () => {
		expect(
			buildTuiTaskAttachExit(
				{ argv: ["tmux", "attach-session", "-t", "cuekit-task-t_abc"] },
				"t_abc",
			),
		).toEqual({
			kind: "attach",
			args: buildTmuxAttachArgs("cuekit-task-t_abc"),
			returnState: { mode: "tasks", selected_task_id: "t_abc" },
		});
	});

	it("reconstructs zellij attach from generic metadata fallback", () => {
		expect(
			getPaneAttachCommand({
				...baseView,
				metadata: { pane_session_name: "ct-t_abc", pane_backend_kind: "zellij" },
			}),
		).toEqual({ argv: ["zellij", "attach", "ct-t_abc"] });
	});

	it("parses zellij attach hints", () => {
		expect(getPaneAttachCommand({ ...baseView, attach_hint: "zellij attach ct-t_abc" })).toEqual({
			argv: ["zellij", "attach", "ct-t_abc"],
		});
	});

	it("preserves structured zellij attach argv", () => {
		const command = getPaneAttachCommand({
			...baseView,
			attach_command: { argv: ["zellij", "attach", "ct-t_abc"] },
			attach_hint: "zellij attach ct-t_abc",
		});
		expect(command).toEqual({ argv: ["zellij", "attach", "ct-t_abc"] });
		if (!command) throw new Error("expected attach command");
		expect(buildTuiTaskAttachExit(command, "t_abc")).toEqual({
			kind: "attach",
			args: ["zellij", "attach", "ct-t_abc"],
			returnState: { mode: "tasks", selected_task_id: "t_abc" },
		});
	});
});
