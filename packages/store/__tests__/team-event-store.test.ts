import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { runMigrations } from "../src/migrate.ts";
import { createSession } from "../src/session-store.ts";
import { createTask } from "../src/task-store.ts";
import { createTaskTeam, deleteTaskTeam } from "../src/task-team-store.ts";
import {
	appendTeamEvent,
	KNOWN_TEAM_EVENT_TYPES,
	listTeamEvents,
	TeamEventTypeSchema,
} from "../src/team-event-store.ts";

let db: Database;

beforeEach(() => {
	db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	createSession(db, {
		id: "s1",
		project_root: "/p",
		worktree_path: "/w",
		parent_agent_kind: "pi",
	});
	createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "Team" });
	createTask(db, {
		id: "t_worker",
		session_id: "s1",
		agent_kind: "pi",
		team_id: "tm_1",
		team_position: "worker",
		objective: "work",
		status: "running",
	});
});

describe("team event store", () => {
	it("appends and lists team events in sequence order", () => {
		appendTeamEvent(db, {
			id: "te_2",
			team_id: "tm_1",
			event_type: "decision",
			message: "Use the grouped reporting surface.",
		});
		appendTeamEvent(db, {
			id: "te_1",
			team_id: "tm_1",
			task_id: "t_worker",
			position: "worker",
			event_type: "finding",
			message: "Worker found the relevant API.",
			payload: { files: ["packages/store/src/team-event-store.ts"] },
		});

		const events = listTeamEvents(db, "tm_1");

		expect(events.map((event) => event.id)).toEqual(["te_2", "te_1"]);
		expect(events[1]).toMatchObject({
			team_id: "tm_1",
			task_id: "t_worker",
			position: "worker",
			event_type: "finding",
			message: "Worker found the relevant API.",
			payload_json: JSON.stringify({ files: ["packages/store/src/team-event-store.ts"] }),
		});
		expect(events[0]?.sequence).toBeLessThan(events[1]?.sequence ?? 0);
	});

	it("accepts the curated event types and any other non-empty string (AE Phase 1 / #568)", () => {
		// The curated recommended set covers the original Swarm-lite values
		// plus the new neutral process markers (note, checkpoint, progress,
		// handoff). KNOWN_TEAM_EVENT_TYPES exposes them for the TUI / filtering.
		expect(KNOWN_TEAM_EVENT_TYPES).toEqual([
			"finding",
			"decision",
			"blocker",
			"review_result",
			"note",
			"checkpoint",
			"progress",
			"handoff",
		]);
		for (const known of KNOWN_TEAM_EVENT_TYPES) {
			expect(TeamEventTypeSchema.safeParse(known).success).toBe(true);
		}
		// Permissive: any non-empty string now passes (custom project labels).
		expect(TeamEventTypeSchema.safeParse("custom-label").success).toBe(true);
		// Empty strings remain rejected.
		expect(TeamEventTypeSchema.safeParse("").success).toBe(false);
	});

	it("cascades team events when the team is deleted", () => {
		appendTeamEvent(db, {
			id: "te_delete",
			team_id: "tm_1",
			event_type: "blocker",
			message: "Need input.",
		});

		expect(listTeamEvents(db, "tm_1")).toHaveLength(1);
		expect(deleteTaskTeam(db, "tm_1")).toBe(true);
		expect(listTeamEvents(db, "tm_1")).toEqual([]);
	});

	it("preserves team events when an optional task link is deleted", () => {
		appendTeamEvent(db, {
			id: "te_task_delete",
			team_id: "tm_1",
			task_id: "t_worker",
			position: "worker",
			event_type: "review_result",
			message: "Review result remains team-level history.",
		});

		db.prepare("delete from tasks where id = ?").run("t_worker");

		const [event] = listTeamEvents(db, "tm_1");
		expect(event?.task_id).toBeNull();
		expect(event?.position).toBe("worker");
	});

	it("rejects task links from a different team", () => {
		createTaskTeam(db, { id: "tm_2", session_id: "s1", title: "Other team" });
		createTask(db, {
			id: "t_other_team",
			session_id: "s1",
			agent_kind: "pi",
			team_id: "tm_2",
			team_position: "worker",
			objective: "other work",
			status: "running",
		});

		expect(() =>
			appendTeamEvent(db, {
				id: "te_wrong_team",
				team_id: "tm_1",
				task_id: "t_other_team",
				event_type: "finding",
				message: "This should not be allowed.",
			}),
		).toThrow(/task_id must belong to the same team/);
		expect(listTeamEvents(db, "tm_1")).toEqual([]);
	});
});
