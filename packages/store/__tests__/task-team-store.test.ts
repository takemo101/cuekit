import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { runMigrations } from "../src/migrate.ts";
import { createSession } from "../src/session-store.ts";
import { createTaskTeam, getTaskTeamById, listTaskTeamsBySession } from "../src/task-team-store.ts";

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
	createSession(db, {
		id: "s2",
		project_root: "/p2",
		worktree_path: "/w2",
		parent_agent_kind: "pi",
	});
});

describe("task team store", () => {
	it("creates and reads task teams", () => {
		const team = createTaskTeam(db, {
			id: "tm_1",
			session_id: "s1",
			title: "Implement teams",
			objective: "Coordinate related tasks",
			metadata: { source: "test" },
		});

		expect(team.id).toBe("tm_1");
		expect(team.session_id).toBe("s1");
		expect(team.title).toBe("Implement teams");
		expect(team.objective).toBe("Coordinate related tasks");
		expect(team.metadata_json).toContain("source");
		expect(getTaskTeamById(db, "tm_1")).toEqual(team);
	});

	it("returns null for unknown teams", () => {
		expect(getTaskTeamById(db, "tm_missing")).toBeNull();
	});

	it("lists teams by session", () => {
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "One" });
		createTaskTeam(db, { id: "tm_2", session_id: "s2", title: "Two" });

		expect(listTaskTeamsBySession(db, "s1").map((team) => team.id)).toEqual(["tm_1"]);
	});
});
