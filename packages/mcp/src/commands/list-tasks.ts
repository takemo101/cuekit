import { resolve } from "node:path";
import {
	encodeTaskListCursor,
	isTerminalTaskStatus,
	JobErrorSchema,
	TaskListFilterSchema,
	TaskSummarySchema,
} from "@cuekit/core";
import { DEFAULT_LIST_TASKS_LIMIT, getTaskById, listTasks, type Task } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { taskRunMetadata } from "../task-run-metadata.ts";

// Reuse core's canonical TaskListFilterSchema for persistence filters and add
// control-surface-only refresh policy here so core/store stay pure.
export const ListTasksInputSchema = TaskListFilterSchema.extend({
	refresh_status: z.boolean().optional(),
});
export type ListTasksInput = z.infer<typeof ListTasksInputSchema>;
type StoreTaskListFilter = z.infer<typeof TaskListFilterSchema>;

function storeFilter(input: ListTasksInput): StoreTaskListFilter {
	const { refresh_status: _refresh_status, ...filter } = input;
	return filter;
}

export const ListTasksOutputSchema = z.union([
	z.object({
		tasks: z.array(TaskSummarySchema),
		// True when another page exists — i.e. the caller should re-request
		// with `cursor: next_cursor`. Probed cheaply by asking the store for
		// limit+1 rows.
		has_more: z.boolean(),
		// Opaque cursor for the next page. Omitted when `has_more` is false so
		// callers can't accidentally walk past the end. Keyset-based — pass it
		// back exactly; never hand-craft.
		next_cursor: z.string().optional(),
	}),
	z.object({ error: JobErrorSchema }),
]);

export type ListTasksOutput = z.infer<typeof ListTasksOutputSchema>;

async function refreshNonTerminalRows(ctx: CommandContext, rows: Task[]): Promise<void> {
	for (const row of rows) {
		if (isTerminalTaskStatus(row.status)) continue;
		const adapterRes = ctx.registry.require(row.agent_kind);
		if (!adapterRes.ok) continue;
		await adapterRes.value.status(row.id);
	}
}

function uniqueRows(rows: Task[]): Task[] {
	const seen = new Set<string>();
	const out: Task[] = [];
	for (const row of rows) {
		if (seen.has(row.id)) continue;
		seen.add(row.id);
		out.push(row);
	}
	return out;
}

function rowStillMatchesFilter(row: Task, filter: StoreTaskListFilter): boolean {
	if (filter.status !== undefined && row.status !== filter.status) return false;
	if (filter.agent_kind !== undefined && row.agent_kind !== filter.agent_kind) return false;
	if (filter.session_id !== undefined && row.session_id !== filter.session_id) return false;
	if (filter.team_id !== undefined && row.team_id !== filter.team_id) return false;
	return true;
}

function hydrateRows(ctx: CommandContext, rows: Task[], filter: StoreTaskListFilter): Task[] {
	return rows
		.map((row) => getTaskById(ctx.db, row.id) ?? row)
		.filter((row) => rowStillMatchesFilter(row, filter));
}

function listWithLegacyCwd(ctx: CommandContext, input: StoreTaskListFilter): Task[] {
	const limit = input.limit ?? DEFAULT_LIST_TASKS_LIMIT;
	const normalizedInput: StoreTaskListFilter = {
		...input,
		...(input.cwd !== undefined ? { cwd: resolve(input.cwd) } : {}),
	};
	const rows = listTasks(ctx.db, { ...normalizedInput, limit });
	if (input.cwd === undefined || input.cwd === normalizedInput.cwd) return rows;
	const legacyRows = listTasks(ctx.db, { ...input, limit });
	return uniqueRows([...rows, ...legacyRows])
		.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))
		.slice(0, limit);
}

export async function runListTasks(
	ctx: CommandContext,
	input: ListTasksInput,
): Promise<ListTasksOutput> {
	// Probe limit+1 so the caller can tell whether another page exists
	// without a follow-up round-trip. Trim the extra row before returning.
	const limit = input.limit ?? DEFAULT_LIST_TASKS_LIMIT;
	let rows: ReturnType<typeof listTasks>;
	try {
		const filter = storeFilter(input);
		rows = listWithLegacyCwd(ctx, { ...filter, limit: limit + 1 });
		const cursorRows = rows;
		if (input.refresh_status !== false) await refreshNonTerminalRows(ctx, rows);
		rows = hydrateRows(ctx, cursorRows.slice(0, limit), filter);
		const has_more = cursorRows.length > limit;
		const page = rows;
		const cursorAnchor = has_more ? cursorRows[Math.min(limit, cursorRows.length) - 1] : undefined;
		const next_cursor =
			has_more && cursorAnchor !== undefined
				? encodeTaskListCursor({ updated_at: cursorAnchor.updated_at, id: cursorAnchor.id })
				: undefined;
		return {
			tasks: page.map((t) => ({
				task_id: t.id,
				agent_kind: t.agent_kind,
				...(t.model ? { model: t.model } : {}),
				...(t.role ? { role: t.role } : {}),
				...(t.team_id ? { team_id: t.team_id } : {}),
				...(t.team_position ? { position: t.team_position } : {}),
				...(t.role_source ? { role_source: t.role_source } : {}),
				...(t.role_selection_reason ? { role_selection_reason: t.role_selection_reason } : {}),
				...taskRunMetadata(t),
				status: t.status,
				summary: t.summary ?? undefined,
				updated_at: t.updated_at,
			})),
			has_more,
			...(next_cursor !== undefined ? { next_cursor } : {}),
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.startsWith("invalid cursor:")) {
			return {
				error: {
					code: "invalid_input",
					message,
					retryable: false,
				},
			};
		}
		throw err;
	}
}
