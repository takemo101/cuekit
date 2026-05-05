import { describe, expect, it } from "bun:test";
import {
	diagnosticsFromPayloads,
	intersectObservedFiles,
	observedFilesFromPayloads,
	parseTaskObservabilityPayload,
} from "../src/task-observability.ts";

describe("task observability payload helpers", () => {
	it("extracts recognized fields and normalizes file lists", () => {
		expect(
			parseTaskObservabilityPayload({
				phase: "testing",
				files: {
					read: ["src/a.ts", "", "src/a.ts", " ./src/b.ts "],
					written: ["src/c.ts"],
				},
				diagnostic: { kind: "timeout", message: "timed out after 100ms" },
			}),
		).toEqual({
			phase: "testing",
			files: {
				read: ["src/a.ts", "./src/b.ts"],
				written: ["src/c.ts"],
			},
			diagnostic: { kind: "timeout", message: "timed out after 100ms" },
		});
	});

	it("ignores payloads without recognized observability fields", () => {
		expect(parseTaskObservabilityPayload(null)).toBeNull();
		expect(parseTaskObservabilityPayload("not json")).toBeNull();
		expect(parseTaskObservabilityPayload({ files: { read: "src/a.ts" } })).toBeNull();
		expect(parseTaskObservabilityPayload({ diagnostic: { kind: "unknown" } })).toBeNull();
	});

	it("keeps valid fields when neighboring fields are malformed", () => {
		expect(
			parseTaskObservabilityPayload({
				phase: "implementation",
				files: { read: ["src/a.ts"], written: "src/b.ts" },
				diagnostic: { kind: "bogus", message: "ignored" },
			}),
		).toEqual({
			phase: "implementation",
			files: { read: ["src/a.ts"] },
		});
	});

	it("aggregates observed files from payload lists", () => {
		expect(
			observedFilesFromPayloads([
				{ files: { read: ["src/a.ts"], written: ["src/b.ts"] } },
				{ files: { read: ["src/a.ts", "src/c.ts"], written: ["src/b.ts", "src/d.ts"] } },
				{ unrelated: true },
			]),
		).toEqual({
			read: ["src/a.ts", "src/c.ts"],
			written: ["src/b.ts", "src/d.ts"],
		});
	});

	it("aggregates recognized diagnostics from payload lists", () => {
		expect(
			diagnosticsFromPayloads([
				{ diagnostic: { kind: "timeout", message: "timed out" } },
				{ diagnostic: { kind: "stale" } },
				{ diagnostic: { kind: "unknown", message: "ignored" } },
			]),
		).toEqual([{ kind: "timeout", message: "timed out" }, { kind: "stale" }]);
	});

	it("returns read/write intersections in read order", () => {
		expect(
			intersectObservedFiles(["src/a.ts", "src/b.ts", "src/c.ts"], ["src/c.ts", "src/a.ts"]),
		).toEqual(["src/a.ts", "src/c.ts"]);
	});
});
