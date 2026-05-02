import { describe, expect, it } from "bun:test";
import { applySubmitDefaults, shouldForceSafeAdapterOptions } from "../src/apply.ts";

describe("applySubmitDefaults", () => {
	it("lets explicit submit input win over config", () => {
		const result = applySubmitDefaults(
			{
				role: "explicit",
				agent_kind: "claude-code",
				model: "sonnet",
				timeout_ms: 1,
				priority: "high",
			},
			{
				submit: { role: "configured", agent: "pi", model: "opus", timeout_ms: 2, priority: "low" },
			},
		);

		expect(result.role).toBe("explicit");
		expect(result.agent_kind).toBe("claude-code");
		expect(result.model).toBe("sonnet");
		expect(result.timeout_ms).toBe(1);
		expect(result.priority).toBe("high");
		expect(result.role_from_config).toBe(false);
		expect(result.agent_from_config).toBe(false);
	});

	it("fills missing submit fields from config", () => {
		const result = applySubmitDefaults(
			{},
			{
				submit: {
					role: "reviewer",
					agent: "claude-code",
					model: "sonnet",
					timeout_ms: 30,
					priority: "normal",
				},
			},
		);

		expect(result).toMatchObject({
			role: "reviewer",
			agent_kind: "claude-code",
			model: "sonnet",
			timeout_ms: 30,
			priority: "normal",
			role_from_config: true,
			agent_from_config: true,
		});
	});
});

describe("shouldForceSafeAdapterOptions", () => {
	it("forces safe options for config-selected role or agent", () => {
		expect(
			shouldForceSafeAdapterOptions({
				config: {},
				agent_kind: "claude-code",
				caller_supplied_adapter_options: false,
				role_from_config: true,
				agent_from_config: false,
			}),
		).toBe(true);
		expect(
			shouldForceSafeAdapterOptions({
				config: {},
				agent_kind: "claude-code",
				caller_supplied_adapter_options: false,
				role_from_config: false,
				agent_from_config: true,
			}),
		).toBe(true);
	});

	it("forces safe options for adapter permissions prompt", () => {
		expect(
			shouldForceSafeAdapterOptions({
				config: { adapters: { "claude-code": { permissions: "prompt" } } },
				agent_kind: "claude-code",
				caller_supplied_adapter_options: false,
				role_from_config: false,
				agent_from_config: false,
			}),
		).toBe(true);
	});

	it("does not override caller supplied adapter options", () => {
		expect(
			shouldForceSafeAdapterOptions({
				config: { adapters: { "claude-code": { permissions: "prompt" } } },
				agent_kind: "claude-code",
				caller_supplied_adapter_options: true,
				role_from_config: true,
				agent_from_config: true,
			}),
		).toBe(false);
	});
});
