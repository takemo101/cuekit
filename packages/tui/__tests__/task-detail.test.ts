import { describe, expect, it } from "bun:test";
import { contextHeight } from "../src/components/task-detail.tsx";

describe("TaskDetail contextHeight", () => {
	it("gives metadata and recent events enough room before transcript output", () => {
		const metadata = [
			{ label: "updated", value: "12:00:00" },
			{ label: "role", value: "docs-writer (builtin)" },
			{ label: "model", value: "haiku" },
			{ label: "transcript", value: ".cuekit/tasks/t_1/transcript.txt" },
		];
		const events = [
			{
				sequence: 89,
				id: "e1",
				task_id: "t_1",
				type: "progress",
				message: "Working",
				payload: null,
				created_at: "2026-05-01T00:00:00.000Z",
			},
			{
				sequence: 90,
				id: "e2",
				task_id: "t_1",
				type: "completed",
				message: "Completed with a long summary",
				payload: null,
				created_at: "2026-05-01T00:00:01.000Z",
			},
		];

		expect(contextHeight(metadata, events)).toBe(9);
	});

	it("caps context height so transcript output still has room", () => {
		const metadata = Array.from({ length: 8 }, (_, index) => ({
			label: `m${index}`,
			value: "value",
		}));
		const events = Array.from({ length: 4 }, (_, index) => ({
			sequence: index + 1,
			id: `e${index}`,
			task_id: "t_1",
			type: "progress",
			message: "x",
			payload: null,
			created_at: "2026-05-01T00:00:00.000Z",
		}));

		expect(contextHeight(metadata, events)).toBe(12);
	});
});
