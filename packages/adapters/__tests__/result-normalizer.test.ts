import { describe, expect, it } from "bun:test";
import type { Task } from "@cuekit/store";
import { normalizeTaskResult } from "../src/result-normalizer.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
	const now = "2026-04-24T10:00:00.000Z";
	return {
		id: "t_abc",
		session_id: "s1",
		parent_task_id: null,
		agent_kind: "claude-code",
		model: null,
		role: null,
		role_source: null,
		role_selection_reason: null,
		team_id: null,
		team_position: null,
		objective: "x",
		status: "completed",
		native_task_ref: null,
		child_token_hash: null,
		summary: null,
		result_ref: null,
		transcript_ref: null,
		created_at: now,
		updated_at: now,
		started_at: now,
		completed_at: now,
		spec_json: null,
		...overrides,
	};
}

describe("normalizeTaskResult", () => {
	it("throws on non-terminal status (caller defect)", () => {
		expect(() => normalizeTaskResult(makeTask({ status: "running" }))).toThrow(/defect/);
	});

	it("builds a minimal result when no refs are present", () => {
		const result = normalizeTaskResult(makeTask({ status: "completed" }));
		expect(result.task_id).toBe("t_abc");
		expect(result.status).toBe("completed");
		expect(result.summary).toBe("");
		expect(result.files_changed).toEqual([]);
		expect(result.artifacts).toEqual([]);
	});

	it("attaches transcript_ref as a transcript artifact", () => {
		const result = normalizeTaskResult(
			makeTask({
				status: "completed",
				transcript_ref: ".cuekit/tasks/t_abc/transcript.md",
			}),
		);
		expect(result.artifacts).toHaveLength(1);
		expect(result.artifacts[0]?.kind).toBe("transcript");
		expect(result.artifacts[0]?.ref).toBe(".cuekit/tasks/t_abc/transcript.md");
	});

	it("attaches result_ref as a json artifact", () => {
		const result = normalizeTaskResult(
			makeTask({
				status: "completed",
				result_ref: ".cuekit/tasks/t_abc/result.json",
			}),
		);
		expect(result.artifacts).toHaveLength(1);
		expect(result.artifacts[0]?.kind).toBe("json");
	});

	it("attaches both artifacts when both refs exist", () => {
		const result = normalizeTaskResult(
			makeTask({
				status: "completed",
				transcript_ref: ".cuekit/tasks/t_abc/transcript.md",
				result_ref: ".cuekit/tasks/t_abc/result.json",
			}),
		);
		expect(result.artifacts.map((a) => a.kind).sort()).toEqual(["json", "transcript"]);
	});

	it("passes summary through when present", () => {
		const result = normalizeTaskResult(
			makeTask({ status: "completed", summary: "Added retry logic" }),
		);
		expect(result.summary).toBe("Added retry logic");
	});

	it("supports all terminal statuses (failed / cancelled / timed_out / blocked)", () => {
		for (const status of ["failed", "cancelled", "timed_out", "blocked"] as const) {
			const result = normalizeTaskResult(makeTask({ status }));
			expect(result.status).toBe(status);
		}
	});
});
