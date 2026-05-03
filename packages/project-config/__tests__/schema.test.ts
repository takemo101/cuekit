import { describe, expect, it } from "bun:test";
import { CuekitProjectConfigSchema } from "../src/schema.ts";

describe("CuekitProjectConfigSchema", () => {
	it("accepts the recommended config shape", () => {
		const parsed = CuekitProjectConfigSchema.parse({
			project: { id: "cuekit", name: "cuekit" },
			tui: { scope: "project" },
			submit: {
				role: "worker",
				agent: "claude-code",
				model: "sonnet",
				timeout_ms: 300000,
				priority: "normal",
			},
			teams: {
				roles: {
					coordinator: "planner",
					worker: "worker",
					reviewer: "reviewer",
					observer: "scout",
				},
				cleanup: "keep-team",
				wait: { timeout_ms: 300000, poll_interval_ms: 2000 },
			},
			adapters: {
				"claude-code": { permissions: "prompt" },
				opencode: { permissions: "prompt" },
			},
		});

		expect(parsed.project?.id).toBe("cuekit");
		expect(parsed.tui?.scope).toBe("project");
		expect(parsed.submit?.agent).toBe("claude-code");
		expect(parsed.teams?.roles?.coordinator).toBe("planner");
	});

	it("allows an omitted project id", () => {
		const parsed = CuekitProjectConfigSchema.parse({ project: { name: "cuekit" } });
		expect(parsed.project?.name).toBe("cuekit");
	});

	it("rejects project-local tui.scope all", () => {
		expect(() => CuekitProjectConfigSchema.parse({ tui: { scope: "all" } })).toThrow();
	});

	it("accepts explicit project-local permission bypass", () => {
		const parsed = CuekitProjectConfigSchema.parse({
			adapters: { "claude-code": { permissions: "bypass" } },
		});

		expect(parsed.adapters?.["claude-code"]?.permissions).toBe("bypass");
	});

	it("rejects unknown top-level keys", () => {
		expect(() => CuekitProjectConfigSchema.parse({ unknown: true })).toThrow();
	});

	it("rejects invalid project ids", () => {
		expect(() => CuekitProjectConfigSchema.parse({ project: { id: "not ok" } })).toThrow();
	});
});
