import { describe, expect, it } from "bun:test";
import type { AdapterCapabilities } from "@cuekit/core";
import { AdapterRegistry } from "../src/adapter-registry.ts";
import type { AgentAdapter } from "../src/agent-adapter.ts";

function stubAdapter(kind: string): AgentAdapter {
	const caps: AdapterCapabilities = {
		agent_kind: kind,
		supports_steering: false,
		supports_attach: false,
		supports_model_selection: false,
	};
	return {
		kind,
		capabilities: () => caps,
		submit: async () => ({
			ok: false,
			error: { code: "unknown", message: "stub" },
		}),
		status: async () => ({
			task_id: "",
			agent_kind: kind,
			status: "failed",
			created_at: "2026-04-24T00:00:00Z",
			updated_at: "2026-04-24T00:00:00Z",
		}),
		steer: async () => ({
			ok: false,
			error: { code: "steering_unsupported", message: "stub" },
		}),
		collect: async () => ({
			ok: false,
			error: { code: "collect_unavailable", message: "stub" },
		}),
		cancel: async () => ({
			ok: false,
			error: { code: "invalid_state", message: "stub" },
		}),
		list: async () => [],
	};
}

describe("AdapterRegistry", () => {
	it("registers and retrieves an adapter by kind", () => {
		const reg = new AdapterRegistry();
		const a = stubAdapter("claude-code");
		reg.register(a);
		expect(reg.get("claude-code")).toBe(a);
	});

	it("returns null for unknown kind via get()", () => {
		const reg = new AdapterRegistry();
		expect(reg.get("nope")).toBeNull();
	});

	it("rejects duplicate registration (caller defect)", () => {
		const reg = new AdapterRegistry();
		reg.register(stubAdapter("claude-code"));
		expect(() => reg.register(stubAdapter("claude-code"))).toThrow(/already registered/);
	});

	it("require() returns adapter_not_found for unknown kind", () => {
		const reg = new AdapterRegistry();
		const res = reg.require("nope");
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error.code).toBe("adapter_not_found");
		}
	});

	it("list() returns capabilities of all registered adapters", () => {
		const reg = new AdapterRegistry();
		reg.register(stubAdapter("claude-code"));
		reg.register(stubAdapter("pi"));
		const caps = reg.list();
		expect(caps.map((c) => c.agent_kind).sort()).toEqual(["claude-code", "pi"]);
	});

	it("kinds() returns registered agent_kinds", () => {
		const reg = new AdapterRegistry();
		reg.register(stubAdapter("claude-code"));
		reg.register(stubAdapter("opencode"));
		expect(reg.kinds().sort()).toEqual(["claude-code", "opencode"]);
	});
});
