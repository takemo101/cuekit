import { describe, expect, it } from "bun:test";
import type { AdapterCapabilities } from "../src/adapter-capabilities.ts";
import {
	canCancelTask,
	ensureCollectable,
	isTerminalTaskStatus,
	validateSpecAgainstCapabilities,
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

	it("rejects queued tasks", () => {
		const result = ensureCollectable("queued");
		expect(result.ok).toBe(false);
	});

	it("rejects input_required tasks", () => {
		const result = ensureCollectable("input_required");
		expect(result.ok).toBe(false);
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

	it("rejects failed and cancelled tasks", () => {
		expect(canCancelTask("failed").ok).toBe(false);
		expect(canCancelTask("cancelled").ok).toBe(false);
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
		expect(validateSpecAgainstCapabilities(baseSpec, caps)).toEqual({
			ok: true,
		});
	});

	it("rejects model when adapter does not support model selection", () => {
		const caps: AdapterCapabilities = {
			agent_kind: "pi",
			supports_steering: true,
			supports_attach: true,
			supports_model_selection: false,
		};
		const result = validateSpecAgainstCapabilities({ ...baseSpec, model: "sonnet" }, caps);
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
		const result = validateSpecAgainstCapabilities({ ...baseSpec, model: "anything-goes" }, caps);
		expect(result.ok).toBe(true);
	});
});
