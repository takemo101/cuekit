import { describe, expect, it } from "bun:test";
import { discoverAgentProfiles } from "../src/discovery.ts";
import { selectAgentProfile } from "../src/selection.ts";

const discovered = discoverAgentProfiles();
if (!discovered.ok) throw new Error(discovered.error);
const profiles = discovered.profiles;

describe("selectAgentProfile", () => {
	it.each([
		["review this diff before PR", "reviewer"],
		["write an implementation plan from this spec", "planner"],
		["debug this failing test", "debugger"],
		["update the README and changelog", "docs-writer"],
		["inspect and map this code path", "scout"],
		["implement this feature", "worker"],
	])("selects %s", (objective, expectedId) => {
		const selected = selectAgentProfile({ objective, profiles });
		expect(selected?.profile.id).toBe(expectedId);
		expect(selected?.reason.length).toBeGreaterThan(0);
	});

	it("falls back deterministically when preferred profile is missing", () => {
		const selected = selectAgentProfile({
			objective: "review the docs diff",
			profiles: profiles.filter((profile) => profile.id !== "reviewer"),
		});
		expect(selected?.profile.id).toBe("worker");
		expect(selected?.reason).toContain("reviewer keywords but profile missing");
	});

	it("returns undefined for no available profiles", () => {
		expect(selectAgentProfile({ objective: "implement", profiles: [] })).toBeUndefined();
	});
});
