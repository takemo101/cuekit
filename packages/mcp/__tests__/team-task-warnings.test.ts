import { describe, expect, it } from "bun:test";
import { coordinatorBatchModeWarnings } from "../src/coordinator-batch-warning.ts";
import {
	COORDINATOR_BATCH_MODE_WARNING,
	MISSING_TEAM_POSITION_WARNING,
	teamTaskWarnings,
} from "../src/team-task-warnings.ts";

describe("teamTaskWarnings", () => {
	it("returns missing_team_position warning when position is undefined", () => {
		const result = teamTaskWarnings({ position: undefined });
		expect(result).toEqual([MISSING_TEAM_POSITION_WARNING]);
	});

	it("returns missing_team_position warning when position is not provided", () => {
		const result = teamTaskWarnings({});
		expect(result).toEqual([MISSING_TEAM_POSITION_WARNING]);
	});

	it("returns coordinator_batch_mode warning when position is coordinator and mode is batch", () => {
		const result = teamTaskWarnings({
			position: "coordinator",
			adapter_options: { mode: "batch" },
		});
		expect(result).toEqual([COORDINATOR_BATCH_MODE_WARNING]);
	});

	it("returns undefined for coordinator position without batch mode", () => {
		const result = teamTaskWarnings({ position: "coordinator" });
		expect(result).toBeUndefined();
	});

	it("returns undefined for worker position", () => {
		const result = teamTaskWarnings({ position: "worker" });
		expect(result).toBeUndefined();
	});

	it("returns undefined for reviewer position", () => {
		const result = teamTaskWarnings({ position: "reviewer" });
		expect(result).toBeUndefined();
	});

	it("returns undefined for finisher position", () => {
		const result = teamTaskWarnings({ position: "finisher" });
		expect(result).toBeUndefined();
	});

	it("returns undefined for observer position", () => {
		const result = teamTaskWarnings({ position: "observer" });
		expect(result).toBeUndefined();
	});

	it("returns only missing_team_position when position is absent even with batch mode", () => {
		const result = teamTaskWarnings({ adapter_options: { mode: "batch" } });
		expect(result).toEqual([MISSING_TEAM_POSITION_WARNING]);
	});

	it("keeps the coordinator-batch compatibility helper undefined for non-coordinator warnings", () => {
		const result = coordinatorBatchModeWarnings({ adapter_options: { mode: "batch" } });
		expect(result).toBeUndefined();
	});
});
