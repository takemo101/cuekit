import { describe, expect, it } from "bun:test";
import { AckSchema } from "../src/ack.ts";
import { AdapterCapabilitiesSchema } from "../src/adapter-capabilities.ts";
import { ArtifactRefSchema } from "../src/artifact-ref.ts";
import { ExpectedOutputSpecSchema } from "../src/expected-output.ts";
import { InputRefSchema } from "../src/input-ref.ts";
import { JobErrorSchema } from "../src/job-error.ts";
import { SessionStatusSchema } from "../src/session-status.ts";
import { SteeringMessageSchema } from "../src/steering-message.ts";
import { TaskHandleSchema } from "../src/task-handle.ts";
import { TaskListFilterSchema } from "../src/task-list-filter.ts";
import { TaskRefsSchema } from "../src/task-refs.ts";
import { TaskResultSchema } from "../src/task-result.ts";
import { TaskSpecSchema } from "../src/task-spec.ts";
import { TaskStatusSchema } from "../src/task-status.ts";
import { TaskStatusViewSchema } from "../src/task-status-view.ts";
import { TaskSummarySchema } from "../src/task-summary.ts";

describe("TaskSpecSchema", () => {
	it("accepts minimal valid spec", () => {
		const result = TaskSpecSchema.safeParse({
			agent_kind: "claude-code",
			objective: "Add retry logic",
		});
		expect(result.success).toBe(true);
	});

	it("accepts spec with model and adapter_options", () => {
		const result = TaskSpecSchema.safeParse({
			agent_kind: "claude-code",
			objective: "Add retry logic",
			model: "sonnet",
			adapter_options: { max_turns: 50 },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.model).toBe("sonnet");
		}
	});

	it("rejects missing objective", () => {
		const result = TaskSpecSchema.safeParse({ agent_kind: "claude-code" });
		expect(result.success).toBe(false);
	});

	it("rejects empty agent_kind", () => {
		const result = TaskSpecSchema.safeParse({ agent_kind: "", objective: "x" });
		expect(result.success).toBe(false);
	});

	it("rejects empty objective", () => {
		const result = TaskSpecSchema.safeParse({ agent_kind: "pi", objective: "" });
		expect(result.success).toBe(false);
	});

	it("rejects empty model string", () => {
		const result = TaskSpecSchema.safeParse({
			agent_kind: "claude-code",
			objective: "x",
			model: "",
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty cwd string", () => {
		const result = TaskSpecSchema.safeParse({
			agent_kind: "pi",
			objective: "x",
			cwd: "",
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty constraint entries", () => {
		const result = TaskSpecSchema.safeParse({
			agent_kind: "pi",
			objective: "x",
			constraints: ["valid", ""],
		});
		expect(result.success).toBe(false);
	});

	it("rejects negative timeout_ms", () => {
		const result = TaskSpecSchema.safeParse({
			agent_kind: "pi",
			objective: "x",
			timeout_ms: -1,
		});
		expect(result.success).toBe(false);
	});

	it("accepts full spec with all optional fields", () => {
		const result = TaskSpecSchema.safeParse({
			agent_kind: "pi",
			objective: "refactor",
			model: "k2p5",
			adapter_options: { provider: "kimi-coding" },
			context: "see handoff",
			constraints: ["no deps"],
			inputs: [{ kind: "file", ref: "/x" }],
			expected_output: { format: "summary" },
			cwd: "/repo",
			timeout_ms: 600000,
			priority: "normal",
			metadata: { parent: "t1" },
		});
		expect(result.success).toBe(true);
	});
});

describe("TaskStatusSchema", () => {
	it("accepts all valid statuses", () => {
		for (const s of [
			"queued",
			"running",
			"input_required",
			"completed",
			"failed",
			"cancelled",
			"timed_out",
			"blocked",
		]) {
			expect(TaskStatusSchema.safeParse(s).success).toBe(true);
		}
	});

	it("rejects unknown status", () => {
		expect(TaskStatusSchema.safeParse("wat").success).toBe(false);
	});
});

describe("SessionStatusSchema", () => {
	it("accepts active/completed/failed/cancelled", () => {
		for (const s of ["active", "completed", "failed", "cancelled"]) {
			expect(SessionStatusSchema.safeParse(s).success).toBe(true);
		}
	});

	it("rejects task-only statuses", () => {
		expect(SessionStatusSchema.safeParse("running").success).toBe(false);
		expect(SessionStatusSchema.safeParse("queued").success).toBe(false);
	});
});

describe("TaskResultSchema", () => {
	it("accepts minimal completed result", () => {
		const result = TaskResultSchema.safeParse({
			task_id: "t1",
			status: "completed",
			summary: "Done",
			files_changed: [],
			artifacts: [],
		});
		expect(result.success).toBe(true);
	});

	it("rejects non-terminal status in result", () => {
		const result = TaskResultSchema.safeParse({
			task_id: "t1",
			status: "running",
			summary: "wip",
			files_changed: [],
			artifacts: [],
		});
		expect(result.success).toBe(false);
	});

	it("accepts failed result with error", () => {
		const result = TaskResultSchema.safeParse({
			task_id: "t1",
			status: "failed",
			summary: "oops",
			files_changed: [],
			artifacts: [],
			error: { code: "runtime_crash", message: "boom", retryable: true },
		});
		expect(result.success).toBe(true);
	});
});

describe("AdapterCapabilitiesSchema", () => {
	it("accepts model-selecting adapter with available_models", () => {
		const result = AdapterCapabilitiesSchema.safeParse({
			agent_kind: "claude-code",
			supports_steering: false,
			supports_attach: true,
			supports_model_selection: true,
			available_models: ["sonnet", "opus"],
		});
		expect(result.success).toBe(true);
	});

	it("accepts adapter without model selection and no available_models", () => {
		const result = AdapterCapabilitiesSchema.safeParse({
			agent_kind: "pi",
			supports_steering: true,
			supports_attach: true,
			supports_model_selection: false,
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing supports_model_selection", () => {
		const result = AdapterCapabilitiesSchema.safeParse({
			agent_kind: "pi",
			supports_steering: true,
			supports_attach: true,
		});
		expect(result.success).toBe(false);
	});

	it("rejects available_models when supports_model_selection is false", () => {
		const result = AdapterCapabilitiesSchema.safeParse({
			agent_kind: "pi",
			supports_steering: true,
			supports_attach: true,
			supports_model_selection: false,
			available_models: ["sonnet"],
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty available_models array", () => {
		const result = AdapterCapabilitiesSchema.safeParse({
			agent_kind: "claude-code",
			supports_steering: false,
			supports_attach: true,
			supports_model_selection: true,
			available_models: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty model name in available_models", () => {
		const result = AdapterCapabilitiesSchema.safeParse({
			agent_kind: "claude-code",
			supports_steering: false,
			supports_attach: true,
			supports_model_selection: true,
			available_models: ["sonnet", ""],
		});
		expect(result.success).toBe(false);
	});
});

describe("JobErrorSchema", () => {
	it("accepts invalid_input code", () => {
		const result = JobErrorSchema.safeParse({
			code: "invalid_input",
			message: "bad model",
		});
		expect(result.success).toBe(true);
	});

	it("accepts task_not_found code", () => {
		const result = JobErrorSchema.safeParse({
			code: "task_not_found",
			message: "...",
		});
		expect(result.success).toBe(true);
	});

	it("rejects unknown code", () => {
		const result = JobErrorSchema.safeParse({ code: "whatever", message: "x" });
		expect(result.success).toBe(false);
	});
});

describe("ArtifactRefSchema", () => {
	it("accepts transcript artifact", () => {
		const result = ArtifactRefSchema.safeParse({
			kind: "transcript",
			ref: ".cuekit/tasks/t1/transcript.md",
		});
		expect(result.success).toBe(true);
	});

	it("rejects unknown kind", () => {
		const result = ArtifactRefSchema.safeParse({ kind: "banana", ref: "x" });
		expect(result.success).toBe(false);
	});
});

describe("AckSchema", () => {
	it("accepts success ack", () => {
		const result = AckSchema.safeParse({ ok: true, message: "done" });
		expect(result.success).toBe(true);
	});

	it("accepts failure ack with error", () => {
		const result = AckSchema.safeParse({
			ok: false,
			error: { code: "steering_unsupported", message: "nope" },
		});
		expect(result.success).toBe(true);
	});

	it("rejects failure ack without error", () => {
		const result = AckSchema.safeParse({ ok: false });
		expect(result.success).toBe(false);
	});
});

describe("TaskStatusViewSchema", () => {
	it("accepts a running task view with attach_hint", () => {
		const result = TaskStatusViewSchema.safeParse({
			task_id: "t1",
			agent_kind: "claude-code",
			status: "running",
			created_at: "2026-04-24T10:00:00Z",
			updated_at: "2026-04-24T10:02:00Z",
			supports_attach: true,
			attach_hint: "tmux attach-session -t cuekit-task-t1",
		});
		expect(result.success).toBe(true);
	});

	it("rejects non-ISO-8601 timestamps", () => {
		const result = TaskStatusViewSchema.safeParse({
			task_id: "t1",
			agent_kind: "claude-code",
			status: "running",
			created_at: "yesterday",
			updated_at: "just now",
		});
		expect(result.success).toBe(false);
	});

	it("accepts timezone-offset timestamps", () => {
		const result = TaskStatusViewSchema.safeParse({
			task_id: "t1",
			agent_kind: "claude-code",
			status: "running",
			created_at: "2026-04-24T19:00:00+09:00",
			updated_at: "2026-04-24T19:02:00+09:00",
		});
		expect(result.success).toBe(true);
	});
});

describe("TaskSummarySchema", () => {
	it("accepts minimal summary", () => {
		const result = TaskSummarySchema.safeParse({
			task_id: "t1",
			agent_kind: "pi",
			status: "running",
			updated_at: "2026-04-24T10:00:00Z",
		});
		expect(result.success).toBe(true);
	});

	it("rejects bad timestamp", () => {
		const result = TaskSummarySchema.safeParse({
			task_id: "t1",
			agent_kind: "pi",
			status: "running",
			updated_at: "recently",
		});
		expect(result.success).toBe(false);
	});
});

describe("TaskHandleSchema", () => {
	it("accepts a valid task_id", () => {
		expect(TaskHandleSchema.safeParse({ task_id: "t_abc" }).success).toBe(true);
	});

	it("rejects empty task_id", () => {
		expect(TaskHandleSchema.safeParse({ task_id: "" }).success).toBe(false);
	});
});

describe("TaskRefsSchema", () => {
	it("accepts both refs", () => {
		expect(
			TaskRefsSchema.safeParse({
				result_ref: ".cuekit/tasks/t1/result.json",
				transcript_ref: ".cuekit/tasks/t1/transcript.md",
			}).success,
		).toBe(true);
	});

	it("accepts neither ref (both optional)", () => {
		expect(TaskRefsSchema.safeParse({}).success).toBe(true);
	});
});

describe("TaskListFilterSchema", () => {
	it("accepts empty filter", () => {
		expect(TaskListFilterSchema.safeParse({}).success).toBe(true);
	});

	it("accepts all fields", () => {
		expect(
			TaskListFilterSchema.safeParse({
				status: "running",
				agent_kind: "claude-code",
				session_id: "s1",
				cwd: "/repo",
			}).success,
		).toBe(true);
	});

	it("rejects bad status", () => {
		expect(TaskListFilterSchema.safeParse({ status: "imaginary" }).success).toBe(false);
	});
});

describe("InputRefSchema", () => {
	it("accepts a file ref", () => {
		expect(InputRefSchema.safeParse({ kind: "file", ref: "/x" }).success).toBe(true);
	});

	it("rejects empty ref", () => {
		expect(InputRefSchema.safeParse({ kind: "file", ref: "" }).success).toBe(false);
	});

	it("rejects unknown kind", () => {
		expect(InputRefSchema.safeParse({ kind: "banana", ref: "x" }).success).toBe(false);
	});
});

describe("ExpectedOutputSpecSchema", () => {
	it("accepts empty", () => {
		expect(ExpectedOutputSpecSchema.safeParse({}).success).toBe(true);
	});

	it("accepts full shape", () => {
		expect(
			ExpectedOutputSpecSchema.safeParse({
				format: "patch",
				require_files_changed: true,
				require_artifacts: false,
				require_tests: true,
				schema_hint: { version: 1 },
			}).success,
		).toBe(true);
	});

	it("rejects unknown format", () => {
		expect(ExpectedOutputSpecSchema.safeParse({ format: "xml" }).success).toBe(false);
	});
});

describe("SteeringMessageSchema", () => {
	it("accepts minimal message", () => {
		expect(
			SteeringMessageSchema.safeParse({
				task_id: "t1",
				message: "also cover edge case",
			}).success,
		).toBe(true);
	});

	it("rejects empty message", () => {
		expect(SteeringMessageSchema.safeParse({ task_id: "t1", message: "" }).success).toBe(false);
	});

	it("rejects empty task_id", () => {
		expect(SteeringMessageSchema.safeParse({ task_id: "", message: "hi" }).success).toBe(false);
	});
});
