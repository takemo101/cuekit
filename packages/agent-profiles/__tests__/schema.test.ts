import { describe, expect, it } from "bun:test";
import { AgentProfileFileSchema, ResolvedAgentProfileSchema } from "../src/schema.ts";

describe("agent profile schemas", () => {
	it("accepts partial override files with id and instructions", () => {
		const parsed = AgentProfileFileSchema.parse({
			id: "reviewer",
			instructions: "Also check tests.",
			source: "user",
		});
		expect(parsed.description).toBeUndefined();
		expect(parsed.instructions_mode).toBe("replace");
		expect(parsed.tags).toBeUndefined();
	});

	it("requires description and instructions after merge", () => {
		expect(() =>
			ResolvedAgentProfileSchema.parse({
				id: "reviewer",
				instructions: "Review carefully.",
				source: "builtin",
				sources: ["builtin"],
			}),
		).toThrow();
		expect(
			ResolvedAgentProfileSchema.parse({
				id: "reviewer",
				description: "Review code",
				instructions: "Review carefully.",
				source: "builtin",
				sources: ["builtin"],
			}).description,
		).toBe("Review code");
	});

	it("rejects reserved auto id", () => {
		expect(() =>
			AgentProfileFileSchema.parse({
				id: "auto",
				source: "project",
				instructions: "invalid",
			}),
		).toThrow(/reserved/);
	});
});
