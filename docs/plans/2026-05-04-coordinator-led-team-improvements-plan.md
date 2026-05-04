# Coordinator-Led Team Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make coordinator-led Task Team workflows feel natural when a coordinator task uses cuekit to create workers, wait for evolving team work, request reviews, and produce a final result.

**Architecture:** Keep cuekit as Swarm-lite: teams remain durable grouping/status primitives, not a scheduler or workflow engine. Add small opt-in command features and prompt/docs guidance around coordinator-led orchestration: dynamic team waiting, coordinator guidance, team deletion, team result/timeline summaries, and cleaner event-focused transcript presentation.

**Tech Stack:** TypeScript, Bun, Zod/incur schemas, SQLite store, cuekit MCP/CLI operations, tmux-backed adapters, OpenTUI TUI package, Markdown docs, GitHub Issues.

---

## Context from coordinator-led dogfood

Dogfood team: `tm_9588b16978a8`

Workflow tried:

1. Parent created a team and submitted only a `pi` coordinator with `timeout_ms: null`.
2. The coordinator used cuekit CLI to submit a worker and reviewer into the same team.
3. The worker proposed a team-level steering operation.
4. The coordinator implemented `cuekit team steer` / MCP `steer_team`.
5. The reviewer reported no issues.
6. Full validation passed: `bun test`, `bun run typecheck`, `bun run check`.

Findings:

1. `team wait` snapshots team membership at call start. This is truthful and race-resistant, but coordinator-led workflows often need to follow tasks created after the wait begins.
2. Coordinator prompt guidance is currently mostly caller-provided. A coordinator needs a standard recipe for submit worker → wait → submit reviewer → final report.
3. `steer_team` solves the immediate broadcast-steering pain, but the MCP surface may eventually want a grouped `steer({ kind })` shape.
4. `team cleanup` deletes terminal tasks but leaves empty team rows. There is no explicit team deletion policy/operation.
5. Coordinator-led results are spread across child events. Parents need an easier team result/timeline view.
6. pi coordinator transcript capture is noisy; event-first summaries are more useful than raw transcript tails for team workflows.

---

## File map

- `packages/mcp/src/commands/wait-team.ts` — current team wait command; add follow-new-tasks semantics here.
- `packages/mcp/src/commands/wait-tasks.ts` — shared wait polling behavior; reuse or extend carefully.
- `packages/mcp/src/commands/get-team-status.ts` — status output and run summary; possible source for stable team membership snapshots.
- `packages/mcp/src/team-run-summary.ts` — event aggregation by position; extend for timeline/result summaries.
- `packages/mcp/src/commands/get-team-result.ts` (new) — candidate command for final coordinator-led team result.
- `packages/mcp/src/commands/delete-team.ts` (new) — candidate command for deleting empty teams.
- `packages/mcp/src/commands/cleanup-team.ts` — existing cleanup behavior; coordinate with deletion policy.
- `packages/mcp/src/operations.ts` — MCP and CLI operation registration/descriptions.
- `packages/mcp/__tests__/commands.test.ts` — command behavior tests.
- `packages/mcp/__tests__/cli.test.ts` — CLI path / MCP tool surface tests.
- `packages/mcp/__tests__/mcp-stdio-integ.test.ts` — stdio MCP tool list tests.
- `packages/adapters/src/task-spec-prompt.ts` — team/coordinator prompt context injection.
- `packages/adapters/__tests__/task-spec-prompt.test.ts` — prompt rendering tests.
- `packages/tui/src/data.ts` and `packages/tui/src/components/task-detail.tsx` — event-first display or transcript sanitization, if UI is touched.
- `docs/designs/cuekit-task-teams-design.md` — Task Teams design and future roadmap.
- `docs/decisions/002-grouped-mcp-surface.md` — grouped MCP surface ADR.
- `README.md`, `docs/guides/project-config.md` — user-facing docs.

---

## Chunk 1: Dynamic team wait for coordinator-created tasks

### Task 1: Add `follow_new_tasks` to `team wait`

**Files:**
- Modify: `packages/mcp/src/commands/wait-team.ts`
- Modify: `packages/mcp/src/commands/wait-tasks.ts` only if shared helper extraction is necessary
- Modify: `packages/mcp/__tests__/commands.test.ts`
- Modify: `packages/mcp/src/operations.ts` descriptions

- [ ] **Step 1: Write the failing test**

Add a `wait-team` test that starts a team with one running coordinator task. During the wait loop, append or create a second team task before the coordinator completes. Call:

```ts
await runWaitTeam(ctx, {
  team_id: "tm_follow",
  timeout_ms: 100,
  poll_interval_ms: 10,
  follow_new_tasks: true,
});
```

Expected behavior:

```ts
expect(result.done).toBe(false); // while the new task is still non-terminal
expect(result.tasks.map((task) => task.task_id)).toContain("t_new_worker");
```

Also add a companion test proving the default remains snapshot behavior:

```ts
expect(snapshotResult.tasks.map((task) => task.task_id)).not.toContain("t_new_worker");
```

Run:

```sh
bun test packages/mcp/__tests__/commands.test.ts -t "wait-team"
```

Expected: FAIL because `follow_new_tasks` is not implemented.

- [ ] **Step 2: Implement schema and polling behavior**

Add `follow_new_tasks?: boolean` to `WaitTeamInputSchema`.

Implementation rules:

- Default `false` preserves current snapshot semantics.
- When `true`, each poll should refresh the current team membership and include newly created tasks.
- The command still uses `timeout_ms` only as parent wait timeout; it must not cancel or mark tasks timed out.
- Avoid infinite quiet waits by respecting the existing deadline exactly.
- Document in output `next_action_hint` when timeout occurs and `follow_new_tasks` is true.

- [ ] **Step 3: Verify focused tests**

Run:

```sh
bun test packages/mcp/__tests__/commands.test.ts -t "wait-team"
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Update docs**

Update `README.md` and `docs/designs/cuekit-task-teams-design.md` with the distinction:

- default team wait = snapshot
- `follow_new_tasks: true` = coordinator-led dynamic team wait

- [ ] **Step 5: Commit**

```sh
git add packages/mcp/src/commands/wait-team.ts packages/mcp/__tests__/commands.test.ts packages/mcp/src/operations.ts README.md docs/designs/cuekit-task-teams-design.md
git commit -m "Add dynamic team wait option"
```

---

## Chunk 2: Coordinator prompt guidance

### Task 2: Add first-class coordinator workflow guidance to team prompts

**Files:**
- Modify: `packages/adapters/src/task-spec-prompt.ts`
- Modify: `packages/adapters/__tests__/task-spec-prompt.test.ts`
- Modify: `docs/designs/cuekit-task-teams-design.md`

- [ ] **Step 1: Write the failing prompt test**

Add a test rendering a task spec with:

```ts
team_context: {
  team_id: "tm_123",
  title: "Coordinator team",
  position: "coordinator",
}
```

Expected prompt includes concise coordinator guidance:

```text
As coordinator, use cuekit tools to submit workers, wait for results, request review, steer stalled tasks, and report a final team summary.
```

Expected prompt does **not** claim cuekit automatically schedules work or routes messages.

Run:

```sh
bun test packages/adapters/__tests__/task-spec-prompt.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement minimal prompt addition**

In `renderTaskSpecPrompt`, when `team_context.position === "coordinator"`, add a short coordinator recipe:

1. inspect team status
2. submit workers via cuekit when needed
3. wait with bounded polling
4. request reviewer tasks
5. use `steer_task` / `steer_team` for stalled work
6. final `report_task_event` / `cuekit tool report --type completed`

Keep it concise to avoid bloating every task prompt.

- [ ] **Step 3: Verify**

Run:

```sh
bun test packages/adapters/__tests__/task-spec-prompt.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add packages/adapters/src/task-spec-prompt.ts packages/adapters/__tests__/task-spec-prompt.test.ts docs/designs/cuekit-task-teams-design.md
git commit -m "Guide coordinator-led team workflows"
```

---

## Chunk 3: Team result and timeline view

### Task 3: Add `team result` / MCP team result operation

**Files:**
- Create: `packages/mcp/src/commands/get-team-result.ts`
- Modify: `packages/mcp/src/team-run-summary.ts`
- Modify: `packages/mcp/src/operations.ts`
- Modify: `packages/mcp/__tests__/commands.test.ts`
- Modify: `packages/mcp/__tests__/cli.test.ts`
- Modify: `packages/mcp/__tests__/mcp-stdio-integ.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing tests**

Create tests that build a team with:

- coordinator completed event
- worker completed event
- reviewer completed event

Call `runGetTeamResult(ctx, { team_id })`.

Expected output:

```ts
expect(result.status).toBe("completed");
expect(result.final_summary).toContain("coordinator final report");
expect(result.timeline.map((event) => event.position)).toEqual([
  "worker",
  "reviewer",
  "coordinator",
]);
```

Also test `team_not_found`.

Run:

```sh
bun test packages/mcp/__tests__/commands.test.ts -t "team result"
```

Expected: FAIL.

- [ ] **Step 2: Implement command**

`get-team-result` should:

- return `team_id`, aggregate `status`, `task_counts`
- include a chronological event timeline with `task_id`, `position`, `type`, `message`, `created_at`
- choose `final_summary` from the latest coordinator terminal report if present, otherwise latest terminal report
- include only durable task events, not raw transcript tails

- [ ] **Step 3: Register CLI/MCP surface**

Preferred prototype shape:

- CLI: `cuekit team result --team_id tm_...`
- MCP: either add to existing `get_task_result` only if it can stay clear, or add `get_team_result` as a focused tool.

If adding MCP `get_team_result`, update `docs/decisions/002-grouped-mcp-surface.md` and tool list tests.

- [ ] **Step 4: Verify**

Run:

```sh
bun test packages/mcp/__tests__/commands.test.ts -t "team result"
bun test packages/mcp/__tests__/cli.test.ts packages/mcp/__tests__/mcp-stdio-integ.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/mcp/src/commands/get-team-result.ts packages/mcp/src/team-run-summary.ts packages/mcp/src/operations.ts packages/mcp/__tests__/commands.test.ts packages/mcp/__tests__/cli.test.ts packages/mcp/__tests__/mcp-stdio-integ.test.ts README.md docs/decisions/002-grouped-mcp-surface.md
git commit -m "Add team result timeline"
```

---

## Chunk 4: Empty team deletion

### Task 4: Add explicit empty-team deletion

**Files:**
- Create: `packages/mcp/src/commands/delete-team.ts`
- Modify: `packages/store/src/task-team-store.ts` if no delete helper exists
- Modify: `packages/store/__tests__/task-team-store.test.ts`
- Modify: `packages/mcp/src/operations.ts`
- Modify: `packages/mcp/__tests__/commands.test.ts`
- Modify: `packages/mcp/__tests__/cli.test.ts`
- Modify: `docs/designs/cuekit-task-teams-design.md`

- [ ] **Step 1: Write store failing test**

Add `deleteTaskTeam(db, team_id)` tests:

```ts
expect(deleteTaskTeam(db, "tm_1")).toBe(true);
expect(getTaskTeamById(db, "tm_1")).toBeNull();
expect(deleteTaskTeam(db, "missing")).toBe(false);
```

Run:

```sh
bun test packages/store/__tests__/task-team-store.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement store helper**

Add a small `deleteTaskTeam` helper in `packages/store/src/task-team-store.ts`.

- [ ] **Step 3: Write command tests**

Command policy:

- empty team: delete succeeds
- team with non-terminal tasks: reject with `invalid_state`
- team with terminal tasks: reject and tell caller to run `team cleanup` first, or choose a `force_empty?: boolean` option if design prefers automatic terminal cleanup
- missing team: `team_not_found`

Start with strict empty-only deletion for safety.

- [ ] **Step 4: Implement command and register**

Add:

- CLI: `cuekit team delete --team_id tm_...`
- MCP grouped `delete` extension: `kind: "team"`, or a separate CLI-only command if grouped MCP should stay narrower.

Prefer grouped MCP extension only if tests/docs make the extra `kind` obvious.

- [ ] **Step 5: Verify and commit**

Run:

```sh
bun test packages/store/__tests__/task-team-store.test.ts
bun test packages/mcp/__tests__/commands.test.ts -t "delete-team"
bun run typecheck
```

Commit:

```sh
git add packages/store packages/mcp docs/designs/cuekit-task-teams-design.md
git commit -m "Add empty team deletion"
```

---

## Chunk 5: Team steering surface cleanup

### Task 5: Evaluate grouped `steer` shape without breaking prototype users

**Files:**
- Modify: `packages/mcp/src/operations.ts`
- Modify: `packages/mcp/__tests__/cli.test.ts`
- Modify: `packages/mcp/__tests__/mcp-stdio-integ.test.ts`
- Modify: `README.md`
- Modify: `docs/decisions/002-grouped-mcp-surface.md`

- [ ] **Step 1: Decide compatibility policy**

Current surface after PR #249:

- `steer_task`
- `steer_team`

Options:

1. Keep both flat steering tools for prototype simplicity.
2. Add grouped `steer({ kind: "task" | "team" })` and keep old names temporarily.
3. Replace both with grouped `steer` before cuekit stabilizes.

Recommendation: open a design issue first; do not change code until the surface decision is approved.

- [ ] **Step 2: If approved, write tool-list tests first**

Expected MCP tools contain `steer` and no longer contain `steer_task` / `steer_team`, or contain all three during compatibility window.

Run:

```sh
bun test packages/mcp/__tests__/cli.test.ts packages/mcp/__tests__/mcp-stdio-integ.test.ts
```

Expected: FAIL before operation update.

- [ ] **Step 3: Implement operation wrapper**

Implement `SteerInputSchema` as discriminated union:

```ts
{ kind: "task", task_id: string, message: string, reason?: string }
{ kind: "team", team_id: string, message: string, reason?: string }
```

Delegate to `runSteerTask` / `runSteerTeam`.

- [ ] **Step 4: Verify and commit**

Run full MCP tests and update docs.

---

## Chunk 6: Event-first team display and transcript noise reduction

### Task 6: Prefer durable events over raw transcript tails in team summaries

**Files:**
- Modify: `packages/mcp/src/team-run-summary.ts`
- Modify: `packages/mcp/__tests__/team-status.test.ts`
- Optional modify: `packages/tui/src/data.ts`
- Optional modify: `packages/tui/__tests__/tui-data.test.ts`
- Modify: `README.md` if user-facing behavior changes

- [ ] **Step 1: Write failing summary test**

Create a team with noisy transcript refs and clean task events. Assert `run_summary.latest_terminal_message` and position summaries use durable events only.

Run:

```sh
bun test packages/mcp/__tests__/team-status.test.ts
```

Expected: FAIL only if current behavior falls back to transcript where events exist.

- [ ] **Step 2: Implement event-first behavior**

Keep transcript tails available in task detail/status, but ensure team-level summaries prefer `task_events`.

- [ ] **Step 3: Add optional TUI sanitization improvements**

Only if a focused failing test exists for pi transcript noise. Do not broadly rewrite transcript sanitizers without evidence.

- [ ] **Step 4: Verify and commit**

Run:

```sh
bun test packages/mcp/__tests__/team-status.test.ts packages/tui/__tests__/tui-data.test.ts
bun run typecheck
```

Commit focused changes.

---

## Suggested implementation order

1. Chunk 1: Dynamic team wait — highest impact for coordinator-led workflows.
2. Chunk 2: Coordinator prompt guidance — low risk, improves autonomous orchestration quality.
3. Chunk 3: Team result/timeline — makes coordinator outputs easy for parents to consume.
4. Chunk 4: Empty team deletion — closes lifecycle gap.
5. Chunk 6: Event-first display — improves observability.
6. Chunk 5: Grouped steer shape — defer until surface policy is approved.

## Final validation checklist

Run before each PR:

```sh
bun test
bun run typecheck
bun run check
```

For dogfood PRs, also run at least one coordinator-led team where the coordinator is `pi`, creates a worker, creates a reviewer, and reports a final summary.
