import { describe, expect, it } from "bun:test";
import {
	applySubmitDefaults,
	applyTeamRoleDefault,
	applyTeamWaitDefaults,
	shouldForceSafeAdapterOptions,
} from "../src/apply.ts";

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

	it("allows explicit null timeout to disable config timeout defaults", () => {
		const result = applySubmitDefaults({ timeout_ms: null }, { submit: { timeout_ms: 30 } });

		expect(result.timeout_ms).toBeUndefined();
	});

	it("keeps null timeout disabled when no config timeout exists", () => {
		const result = applySubmitDefaults({ timeout_ms: null }, {});

		expect(result.timeout_ms).toBeUndefined();
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

describe("applyTeamRoleDefault", () => {
	it("uses position role defaults when role is omitted", () => {
		expect(
			applyTeamRoleDefault(
				{ position: "worker" },
				{ teams: { roles: { worker: "implementer", coordinator: "lead" } } },
			),
		).toEqual({ role: "implementer", role_from_team_config: true });
	});

	it("does not overwrite explicit role", () => {
		expect(
			applyTeamRoleDefault(
				{ position: "worker", role: "explicit" },
				{ teams: { roles: { worker: "implementer" } } },
			),
		).toEqual({ role: "explicit", role_from_team_config: false });
	});

	it("resolves finisher position role default", () => {
		expect(
			applyTeamRoleDefault(
				{ position: "finisher" },
				{ teams: { roles: { finisher: "pr-finisher" } } },
			),
		).toEqual({ role: "pr-finisher", role_from_team_config: true });
	});
});

describe("applyTeamWaitDefaults", () => {
	it("fills wait defaults while preserving explicit input", () => {
		expect(
			applyTeamWaitDefaults(
				{ timeout_ms: 5 },
				{ teams: { wait: { timeout_ms: 100, poll_interval_ms: 2 } } },
			),
		).toEqual({ timeout_ms: 5, poll_interval_ms: 2 });
	});
});
