import { describe, expect, it } from "bun:test";
import type { AdapterCapabilities } from "../src/adapter-capabilities.ts";
import {
	canCancelTask,
	ensureCollectable,
	isTerminalTaskStatus,
	validateSpecAgainstCapabilities,
	validateTaskTransition,
} from "../src/task-lifecycle.ts";
import type { TaskSpec } from "../src/task-spec.ts";

describe("isTerminalTaskStatus", () => {
	it("recognizes terminal statuses", () => {
		expect(isTerminalTaskStatus("completed")).toBe(true);
		expect(isTerminalTaskStatus("failed")).toBe(true);
		expect(isTerminalTaskStatus("cancelled")).toBe(true);
		expect(isTerminalTaskStatus("timed_out")).toBe(true);
		expect(isTerminalTaskStatus("blocked")).toBe(true);
	});

	it("rejects non-terminal statuses", () => {
		expect(isTerminalTaskStatus("queued")).toBe(false);
		expect(isTerminalTaskStatus("running")).toBe(false);
		expect(isTerminalTaskStatus("input_required")).toBe(false);
	});

	it("narrows the type for terminal branches", () => {
		// Compile-time check: if narrowing works, assigning to TerminalTaskResultStatus holds.
		const s: "running" | "completed" = "completed";
		if (isTerminalTaskStatus(s)) {
			const narrowed: "completed" | "failed" | "cancelled" | "timed_out" | "blocked" = s;
			expect(narrowed).toBe("completed");
		}
	});
});

describe("ensureCollectable", () => {
	it("allows terminal tasks", () => {
		expect(ensureCollectable("completed")).toEqual({ ok: true });
		expect(ensureCollectable("failed")).toEqual({ ok: true });
		expect(ensureCollectable("blocked")).toEqual({ ok: true });
	});

	it("rejects running tasks with invalid_state", () => {
		const result = ensureCollectable("running");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("invalid_state");
			expect(result.error.retryable).toBe(false);
		}
	});

	it("rejects queued and input_required tasks", () => {
		expect(ensureCollectable("queued").ok).toBe(false);
		expect(ensureCollectable("input_required").ok).toBe(false);
	});
});

describe("canCancelTask", () => {
	it("allows non-terminal tasks", () => {
		expect(canCancelTask("queued")).toEqual({ ok: true });
		expect(canCancelTask("running")).toEqual({ ok: true });
		expect(canCancelTask("input_required")).toEqual({ ok: true });
	});

	it("rejects already-terminal tasks with invalid_state", () => {
		const result = canCancelTask("completed");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("invalid_state");
		}
	});

	it("rejects failed / cancelled / timed_out / blocked", () => {
		expect(canCancelTask("failed").ok).toBe(false);
		expect(canCancelTask("cancelled").ok).toBe(false);
		expect(canCancelTask("timed_out").ok).toBe(false);
		expect(canCancelTask("blocked").ok).toBe(false);
	});
});

describe("validateTaskTransition", () => {
	it("allows queued → running", () => {
		expect(validateTaskTransition("queued", "running").ok).toBe(true);
	});

	it("allows running → completed / failed / input_required / blocked / cancelled / timed_out", () => {
		for (const to of [
			"completed",
			"failed",
			"input_required",
			"blocked",
			"cancelled",
			"timed_out",
		] as const) {
			expect(validateTaskTransition("running", to).ok).toBe(true);
		}
	});

	it("allows input_required → running (resume)", () => {
		expect(validateTaskTransition("input_required", "running").ok).toBe(true);
	});

	it("allows blocked → running (remediation)", () => {
		expect(validateTaskTransition("blocked", "running").ok).toBe(true);
	});

	it("rejects same-state transitions", () => {
		const result = validateTaskTransition("running", "running");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("invalid_state");
		}
	});

	it("rejects queued → completed (cannot skip running)", () => {
		expect(validateTaskTransition("queued", "completed").ok).toBe(false);
	});

	it("rejects outbound transitions from terminal states", () => {
		for (const from of ["completed", "failed", "cancelled", "timed_out"] as const) {
			expect(validateTaskTransition(from, "running").ok).toBe(false);
		}
	});

	it("includes from/to in error details", () => {
		const result = validateTaskTransition("completed", "running");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.details).toEqual({ from: "completed", to: "running" });
		}
	});
});

describe("validateSpecAgainstCapabilities", () => {
	const baseSpec: TaskSpec = {
		agent_kind: "claude-code",
		objective: "Do the thing",
	};

	it("passes when model is omitted", () => {
		const caps: AdapterCapabilities = {
			agent_kind: "claude-code",
			supports_steering: false,
			supports_attach: true,
			supports_model_selection: true,
			available_models: ["sonnet", "opus"],
		};
		expect(validateSpecAgainstCapabilities(baseSpec, caps)).toEqual({ ok: true });
	});

	it("rejects agent_kind mismatch between spec and caps", () => {
		const caps: AdapterCapabilities = {
			agent_kind: "pi",
			supports_steering: true,
			supports_attach: true,
			supports_model_selection: false,
		};
		const result = validateSpecAgainstCapabilities(baseSpec, caps);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("invalid_input");
		}
	});

	it("rejects model when adapter does not support model selection", () => {
		const caps: AdapterCapabilities = {
			agent_kind: "pi",
			supports_steering: true,
			supports_attach: true,
			supports_model_selection: false,
		};
		const result = validateSpecAgainstCapabilities(
			{ ...baseSpec, agent_kind: "pi", model: "anything" },
			caps,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("invalid_input");
		}
	});

	it("rejects model not in available_models", () => {
		const caps: AdapterCapabilities = {
			agent_kind: "claude-code",
			supports_steering: false,
			supports_attach: true,
			supports_model_selection: true,
			available_models: ["sonnet", "opus"],
		};
		const result = validateSpecAgainstCapabilities({ ...baseSpec, model: "gpt-4" }, caps);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("invalid_input");
			expect(result.error.details).toBeDefined();
		}
	});

	it("accepts model in available_models", () => {
		const caps: AdapterCapabilities = {
			agent_kind: "claude-code",
			supports_steering: false,
			supports_attach: true,
			supports_model_selection: true,
			available_models: ["sonnet", "opus"],
		};
		const result = validateSpecAgainstCapabilities({ ...baseSpec, model: "opus" }, caps);
		expect(result.ok).toBe(true);
	});

	it("accepts any model when adapter has no available_models list", () => {
		const caps: AdapterCapabilities = {
			agent_kind: "opencode",
			supports_steering: true,
			supports_attach: true,
			supports_model_selection: true,
		};
		const result = validateSpecAgainstCapabilities(
			{ ...baseSpec, agent_kind: "opencode", model: "anything-goes" },
			caps,
		);
		expect(result.ok).toBe(true);
	});
});
