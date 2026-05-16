import type { Database } from "bun:sqlite";
// @ts-expect-error Bun text loader imports SQL migration assets for bundled installs.
import initSql from "./sql/001-init.sql" with { type: "text" };
// @ts-expect-error Bun text loader imports SQL migration assets for bundled installs.
import tasksUpdatedAtIndexSql from "./sql/002-tasks-updated-at-index.sql" with { type: "text" };
// @ts-expect-error Bun text loader imports SQL migration assets for bundled installs.
import tasksStartedAtSql from "./sql/003-tasks-started-at.sql" with { type: "text" };
// @ts-expect-error Bun text loader imports SQL migration assets for bundled installs.
import tasksRenameTargetAgentKindSql from "./sql/004-tasks-rename-target-agent-kind.sql" with {
	type: "text",
};
// @ts-expect-error Bun text loader imports SQL migration assets for bundled installs.
import tasksSpecJsonSql from "./sql/005-tasks-spec-json.sql" with { type: "text" };
// @ts-expect-error Bun text loader imports SQL migration assets for bundled installs.
import childReportingSql from "./sql/006-child-reporting.sql" with { type: "text" };
// @ts-expect-error Bun text loader imports SQL migration assets for bundled installs.
import taskEventsDeleteCascadeSql from "./sql/007-task-events-delete-cascade.sql" with {
	type: "text",
};
// @ts-expect-error Bun text loader imports SQL migration assets for bundled installs.
import taskRoleMetadataSql from "./sql/008-task-role-metadata.sql" with { type: "text" };
// @ts-expect-error Bun text loader imports SQL migration assets for bundled installs.
import taskTeamsSql from "./sql/009-task-teams.sql" with { type: "text" };
// @ts-expect-error Bun text loader imports SQL migration assets for bundled installs.
import projectConfigIdentitySql from "./sql/010-project-config-identity.sql" with { type: "text" };
// @ts-expect-error Bun text loader imports SQL migration assets for bundled installs.
import teamEventsSql from "./sql/011-team-events.sql" with { type: "text" };
// @ts-expect-error Bun text loader imports SQL migration assets for bundled installs.
import taskEventsTeamSequenceSql from "./sql/012-task-events-team-sequence.sql" with {
	type: "text",
};

const MIGRATIONS = [
	["001-init.sql", initSql],
	["002-tasks-updated-at-index.sql", tasksUpdatedAtIndexSql],
	["003-tasks-started-at.sql", tasksStartedAtSql],
	["004-tasks-rename-target-agent-kind.sql", tasksRenameTargetAgentKindSql],
	["005-tasks-spec-json.sql", tasksSpecJsonSql],
	["006-child-reporting.sql", childReportingSql],
	["007-task-events-delete-cascade.sql", taskEventsDeleteCascadeSql],
	["008-task-role-metadata.sql", taskRoleMetadataSql],
	["009-task-teams.sql", taskTeamsSql],
	["010-project-config-identity.sql", projectConfigIdentitySql],
	["011-team-events.sql", teamEventsSql],
	["012-task-events-team-sequence.sql", taskEventsTeamSequenceSql],
] as const;

// Bootstrap table created outside the migration files so it can be relied on
// by the tracking logic itself. Idempotent via `if not exists`.
const BOOTSTRAP_SQL = `
create table if not exists schema_migrations (
	version text primary key,
	applied_at text not null
);
`;

export function runMigrations(db: Database): void {
	db.exec(BOOTSTRAP_SQL);
	db.transaction(() => {
		const checkApplied = db.prepare("select 1 from schema_migrations where version = ?");
		const recordApplied = db.prepare(
			"insert into schema_migrations (version, applied_at) values (?, ?)",
		);
		for (const [version, sql] of MIGRATIONS) {
			if (checkApplied.get(version)) continue;
			db.exec(sql);
			recordApplied.run(version, new Date().toISOString());
		}
	})();
}

export function getAppliedMigrations(db: Database): string[] {
	// Returns empty array if bootstrap has not run yet — safer than throwing.
	const exists = db
		.prepare("select 1 from sqlite_master where type = 'table' and name = 'schema_migrations'")
		.get();
	if (!exists) return [];
	const rows = db.prepare("select version from schema_migrations order by version").all() as Array<{
		version: string;
	}>;
	return rows.map((r) => r.version);
}
