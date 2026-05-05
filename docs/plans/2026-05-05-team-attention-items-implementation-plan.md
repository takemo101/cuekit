# Team Attention Items Implementation Plan

> **For agentic workers:** REQUIRED: Use cuekit team strategies for non-trivial cuekit repo work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add derived `attention_items` summaries over existing `task_events` so parents/coordinators can quickly see important worker/reviewer/finisher reports without adding notification delivery, ack state, auto-steer, or auto-wake.

**Architecture:** Implement attention items as a small read-only helper in the MCP package. The helper takes team tasks, reads existing `task_events`, filters important non-coordinator events, sorts by global event sequence, and returns a capped list. Existing team status/wait run summaries and team results expose the derived list; coordinator prompts/docs explain how to inspect it.

**Tech Stack:** TypeScript, Zod schemas via `incur`, Bun tests, existing cuekit MCP command helpers, existing SQLite `task_events` APIs.

---

## Issue Breakdown

1. **Issue 1 — Add a derived team attention helper**
   - Scope: new helper/schema for extracting attention items from team task events.
   - Output: tested helper that excludes coordinators, includes important event types, sorts by `sequence`, caps output, and avoids role-specific behavior.

2. **Issue 2 — Expose attention items in team status/wait run summaries**
   - Scope: `TeamRunSummarySchema` and `buildTeamRunSummary()`.
   - Output: `run_summary.attention_items` appears in `get_team_status` and `wait_team` because both use the shared run summary.

3. **Issue 3 — Expose attention items in team result**
   - Scope: `GetTeamResultOutputSchema` and `runGetTeamResult()`.
   - Output: `get_team_result.attention_items` appears next to the full timeline.

4. **Issue 4 — Add coordinator prompt guidance and docs alignment**
   - Scope: strategy prompt text and design docs.
   - Output: coordinators are told to inspect `attention_items`; docs clearly keep auto-wake/auto-steer out of scope.

5. **Issue 5 — End-to-end validation and dogfood review**
   - Scope: full test/check run and strategy-backed review.
   - Output: validation evidence and reviewer approval before PR finishing.

---

## Chunk 1: Derived Attention Helper

### Task 1: Create a helper schema and extraction function

**Files:**
- Create: `packages/mcp/src/team-attention.ts`
- Test: `packages/mcp/__tests__/team-attention.test.ts`

- [ ] **Step 1: Write failing tests for basic extraction**

Create `packages/mcp/__tests__/team-attention.test.ts` with a small in-memory DB setup following existing MCP/store tests. Cover:

```ts
it("derives attention items from non-coordinator important events", () => {
  // setup team tasks:
  // - coordinator completed event: excluded
  // - worker blocked event: included
  // - reviewer failed event: included
  // - finisher completed event: included
  // - worker progress event: excluded

  const items = buildTeamAttentionItems(db, tasks);

  expect(items.map((item) => item.type)).toEqual(["blocked", "failed", "completed"]);
  expect(items.map((item) => item.position)).toEqual(["worker", "reviewer", "finisher"]);
  expect(items.every((item) => item.task_id !== "t_coord")).toBe(true);
});
```

- [ ] **Step 2: Write failing tests for help requests and ordering**

Add tests:

```ts
it("includes help_requested even without terminal status", () => { ... });
it("sorts globally by task event sequence, not task iteration order", () => { ... });
```

The ordering test should create tasks in one order and append events in a different order; assert sequence order wins.

- [ ] **Step 3: Write failing test for cap behavior**

Use a small explicit limit:

```ts
const items = buildTeamAttentionItems(db, tasks, { limit: 2 });
expect(items).toHaveLength(2);
expect(items.map((item) => item.sequence)).toEqual([latestMinusOne, latest]);
```

Recommendation: cap to the **most recent N by sequence**, returned in ascending sequence order.

- [ ] **Step 4: Run tests and confirm they fail**

Run:

```bash
bun test packages/mcp/__tests__/team-attention.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 5: Implement minimal helper**

In `packages/mcp/src/team-attention.ts`:

```ts
import { TeamPositionSchema } from "@cuekit/core";
import { listTaskEvents, type Task } from "@cuekit/store";
import type { Database } from "bun:sqlite";
import { z } from "incur";

const ATTENTION_TYPES = new Set(["completed", "failed", "blocked", "help_requested"]);
const DEFAULT_ATTENTION_LIMIT = 10;

export const TeamAttentionItemSchema = z.object({
  sequence: z.number().int().positive(),
  task_id: z.string(),
  position: TeamPositionSchema.optional(),
  type: z.enum(["completed", "failed", "blocked", "help_requested"]),
  reason: z.enum(["terminal_report", "help_requested"]),
  message: z.string().optional(),
  created_at: z.string().datetime({ offset: true }),
});

export type TeamAttentionItem = z.infer<typeof TeamAttentionItemSchema>;

export function buildTeamAttentionItems(
  db: Database,
  tasks: Task[],
  options: { limit?: number } = {},
): TeamAttentionItem[] {
  const limit = options.limit ?? DEFAULT_ATTENTION_LIMIT;
  if (limit <= 0) return [];

  const items = tasks.flatMap((task) => {
    if (task.team_position === "coordinator") return [];
    return listTaskEvents(db, task.id)
      .filter((event) => ATTENTION_TYPES.has(event.type))
      .map((event) => ({
        sequence: event.sequence,
        task_id: task.id,
        ...(task.team_position ? { position: task.team_position } : {}),
        type: event.type as TeamAttentionItem["type"],
        reason: event.type === "help_requested" ? "help_requested" as const : "terminal_report" as const,
        ...(event.message ? { message: event.message } : {}),
        created_at: event.created_at,
      }));
  });

  return items.toSorted((a, b) => a.sequence - b.sequence).slice(-limit);
}
```

Adjust imports/types to match project conventions. Do not special-case `role: pr-finisher`.

- [ ] **Step 6: Run helper tests**

Run:

```bash
bun test packages/mcp/__tests__/team-attention.test.ts
```

Expected: PASS.

---

## Chunk 2: Run Summary Surface

### Task 2: Add `run_summary.attention_items`

**Files:**
- Modify: `packages/mcp/src/team-run-summary.ts`
- Modify: `packages/mcp/__tests__/commands.test.ts`
- Test: `packages/mcp/__tests__/commands.test.ts`

- [ ] **Step 1: Write failing get-team-status test**

Extend `get-team-status summarizes child reports by position` or add a new focused test. Setup:

- coordinator completed event,
- worker blocked event,
- reviewer failed event,
- finisher completed event.

Assert:

```ts
expect(result.run_summary.attention_items?.map((item) => item.position)).toEqual([
  "worker",
  "reviewer",
  "finisher",
]);
expect(result.run_summary.attention_items?.map((item) => item.reason)).toEqual([
  "terminal_report",
  "terminal_report",
  "terminal_report",
]);
expect(result.run_summary.attention_items?.some((item) => item.position === "coordinator")).toBe(false);
```

- [ ] **Step 2: Run targeted test and confirm failure**

Run:

```bash
bun test packages/mcp/__tests__/commands.test.ts
```

Expected: FAIL because `attention_items` is not in schema/output.

- [ ] **Step 3: Add schema field**

In `packages/mcp/src/team-run-summary.ts`:

- import `TeamAttentionItemSchema` and `buildTeamAttentionItems`,
- add to `TeamRunSummarySchema`:

```ts
attention_items: z.array(TeamAttentionItemSchema).optional(),
```

- [ ] **Step 4: Add derived output**

In `buildTeamRunSummary()`:

```ts
const attentionItems = buildTeamAttentionItems(ctx.db, tasks);
...
...(attentionItems.length > 0 ? { attention_items: attentionItems } : {}),
```

Keep `open_attention` as-is. It is for current non-terminal task attention; `attention_items` is historical event excerpts.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
bun test packages/mcp/__tests__/team-attention.test.ts packages/mcp/__tests__/commands.test.ts
```

Expected: PASS.

---

## Chunk 3: Team Result Surface

### Task 3: Add `get_team_result.attention_items`

**Files:**
- Modify: `packages/mcp/src/commands/get-team-result.ts`
- Modify: `packages/mcp/__tests__/commands.test.ts`

- [ ] **Step 1: Write failing team result test**

Extend `returns an event-first timeline and coordinator final summary` or add a new focused test:

```ts
expect(result.timeline.map((event) => event.position)).toContain("finisher");
expect(result.attention_items?.map((item) => item.position)).toEqual([
  "worker",
  "reviewer",
  "finisher",
]);
expect(result.attention_items?.some((item) => item.position === "coordinator")).toBe(false);
```

If the test includes `worker completed`, `reviewer completed`, and `finisher completed`, all are attention items by the initial rule.

- [ ] **Step 2: Run targeted test and confirm failure**

Run:

```bash
bun test packages/mcp/__tests__/commands.test.ts
```

Expected: FAIL because `attention_items` is absent.

- [ ] **Step 3: Add output schema field**

In `GetTeamResultOutputSchema`, add:

```ts
attention_items: z.array(TeamAttentionItemSchema).optional(),
```

- [ ] **Step 4: Add derived output**

In `runGetTeamResult()`:

```ts
const attentionItems = buildTeamAttentionItems(ctx.db, tasks);
...
...(attentionItems.length > 0 ? { attention_items: attentionItems } : {}),
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
bun test packages/mcp/__tests__/team-attention.test.ts packages/mcp/__tests__/commands.test.ts
```

Expected: PASS.

---

## Chunk 4: Coordinator Guidance and Docs

### Task 4: Update strategy prompt guidance

**Files:**
- Modify: `packages/mcp/src/team-strategy.ts`
- Modify: `packages/mcp/__tests__/team-strategy.test.ts`

- [ ] **Step 1: Write failing prompt test**

In `packages/mcp/__tests__/team-strategy.test.ts`, assert:

```ts
expect(prompt).toContain("attention_items");
expect(prompt).toContain("inspect them before deciding whether to continue");
```

- [ ] **Step 2: Run targeted test and confirm failure**

Run:

```bash
bun test packages/mcp/__tests__/team-strategy.test.ts
```

Expected: FAIL until guidance is added.

- [ ] **Step 3: Update prompt text**

Add a concise prompt section in `renderTeamStrategyPrompt()`:

```text
When team status or result includes attention_items, inspect them before deciding whether to continue, submit more tasks, steer a task, or emit your final report.
```

Do not imply automatic steering or waking.

- [ ] **Step 4: Run prompt tests**

Run:

```bash
bun test packages/mcp/__tests__/team-strategy.test.ts
```

Expected: PASS.

### Task 5: Update docs from draft to implemented foundation

**Files:**
- Modify: `docs/designs/cuekit-team-attention-items-design.md`
- Modify: `docs/designs/cuekit-coordinator-notifications-routing-design.md` if needed
- Modify: `docs/designs/cuekit-team-strategies-design.md` if prompt guidance docs are mirrored there

- [ ] **Step 1: Update status wording**

After code lands, change the attention items design status from draft-only to foundation implemented, while keeping future ack/delivery/wake as non-goals.

- [ ] **Step 2: Document `open_attention` relationship clearly**

Ensure docs say:

- `open_attention`: current non-terminal tasks needing attention,
- `attention_items`: event-based excerpts from `task_events`.

- [ ] **Step 3: Run docs check**

Run:

```bash
bun run check
```

Expected: PASS.

---

## Chunk 5: Validation and Review

### Task 6: Full validation

**Files:**
- No planned source edits unless validation finds issues.

- [ ] **Step 1: Run targeted tests**

```bash
bun test packages/mcp/__tests__/team-attention.test.ts packages/mcp/__tests__/commands.test.ts packages/mcp/__tests__/team-strategy.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full validation**

```bash
bun run check
bun run typecheck
bun test
```

Expected: PASS.

- [ ] **Step 3: Search for forbidden mechanisms**

```bash
rg -n "parent_notifications|auto-steer|auto-wake|delivery queue|websocket|subscribe|ack state|read/unread" packages docs/designs/cuekit-team-attention-items-design.md
```

Expected: package code should not include new forbidden mechanisms. Docs may mention them only as non-goals.

### Task 7: Review and PR finish

**Files:**
- No planned source edits unless review finds issues.

- [ ] **Step 1: Request implementation review**

Reviewer should verify:

- attention items are derived from `task_events`,
- coordinator events are excluded,
- helper sorts by `sequence`,
- cap behavior is deterministic,
- `open_attention` and `attention_items` do not conflict,
- no role-specific `pr-finisher` logic,
- no auto-wake/auto-steer/notification delivery.

- [ ] **Step 2: Fix review findings**

Apply only necessary changes and rerun targeted tests.

- [ ] **Step 3: Use PR finisher only if requested**

If PR creation/merge is requested, use the finisher flow after validation and review.

---

## Suggested GitHub Issue Bodies

### Issue 1: Add derived team attention item helper

```markdown
## Goal
Add a small MCP helper that derives team `attention_items` from existing `task_events` without adding notification delivery, ack state, or new storage.

## Scope
- Create `packages/mcp/src/team-attention.ts`.
- Export `TeamAttentionItemSchema`, `TeamAttentionItem`, and `buildTeamAttentionItems()`.
- Include non-coordinator events with type `completed`, `failed`, `blocked`, or `help_requested`.
- Sort by global `task_events.sequence`.
- Cap to a small recent limit, default 10.

## Files
- `packages/mcp/src/team-attention.ts`
- `packages/mcp/__tests__/team-attention.test.ts`

## Acceptance Criteria
- [ ] Coordinator events are excluded.
- [ ] Worker blocked, reviewer failed, finisher completed, and help_requested events are included.
- [ ] Progress/log events are excluded.
- [ ] Items are sorted by event sequence, not task iteration order.
- [ ] Limit/cap behavior is deterministic.
- [ ] No logic special-cases `role: pr-finisher`.

## Validation
```bash
bun test packages/mcp/__tests__/team-attention.test.ts
```
```

### Issue 2: Expose attention_items in team status and wait run summaries

```markdown
## Goal
Expose derived team attention items in `run_summary` so `get_team_status` and `wait_team` show important non-coordinator reports directly.

## Scope
- Add `attention_items` to `TeamRunSummarySchema`.
- Call `buildTeamAttentionItems()` from `buildTeamRunSummary()`.
- Keep existing `open_attention` behavior unchanged.

## Files
- `packages/mcp/src/team-run-summary.ts`
- `packages/mcp/__tests__/commands.test.ts`

## Acceptance Criteria
- [ ] `run_summary.attention_items` appears when important events exist.
- [ ] The field is omitted or empty when no important events exist.
- [ ] `open_attention` continues to represent current non-terminal task attention.
- [ ] `attention_items` contains event-based excerpts from `task_events`.
- [ ] Coordinator terminal reports are excluded from attention items.

## Validation
```bash
bun test packages/mcp/__tests__/team-attention.test.ts packages/mcp/__tests__/commands.test.ts
```
```

### Issue 3: Expose attention_items in get_team_result

```markdown
## Goal
Expose the same derived attention items in `get_team_result` next to the full event timeline.

## Scope
- Add `attention_items` to `GetTeamResultOutputSchema`.
- Call `buildTeamAttentionItems()` from `runGetTeamResult()`.
- Keep `timeline` as the complete audit trail.

## Files
- `packages/mcp/src/commands/get-team-result.ts`
- `packages/mcp/__tests__/commands.test.ts`

## Acceptance Criteria
- [ ] `get_team_result.attention_items` is present when important non-coordinator events exist.
- [ ] `timeline` remains unchanged and complete.
- [ ] Attention items match the helper behavior used by run summaries.
- [ ] Coordinator final reports can still drive `final_summary` but are not attention items.

## Validation
```bash
bun test packages/mcp/__tests__/team-attention.test.ts packages/mcp/__tests__/commands.test.ts
```
```

### Issue 4: Add coordinator guidance and docs for attention_items

```markdown
## Goal
Teach coordinators and readers how to use `attention_items` while preserving cuekit's guidance-first, Swarm-lite model.

## Scope
- Add coordinator prompt guidance to inspect `attention_items` before continuing, steering, submitting follow-up work, or final reporting.
- Update docs to mark the attention items foundation as implemented once code lands.
- Document the relationship between `open_attention` and `attention_items`.
- Reaffirm that auto-wake, auto-steer, ack/read state, delivery queues, and `parent_notifications` remain out of scope.

## Files
- `packages/mcp/src/team-strategy.ts`
- `packages/mcp/__tests__/team-strategy.test.ts`
- `docs/designs/cuekit-team-attention-items-design.md`
- `docs/designs/cuekit-coordinator-notifications-routing-design.md`
- `docs/designs/cuekit-team-strategies-design.md` if needed

## Acceptance Criteria
- [ ] Rendered strategy prompt mentions `attention_items`.
- [ ] Prompt wording does not imply automatic steering/wake.
- [ ] Docs distinguish `open_attention` from `attention_items`.
- [ ] Docs retain non-goals for notification delivery, ack state, auto-steer, and auto-wake.

## Validation
```bash
bun test packages/mcp/__tests__/team-strategy.test.ts
bun run check
```
```

### Issue 5: Validate and dogfood team attention items end-to-end

```markdown
## Goal
Validate attention items end-to-end with tests, review, and cuekit dogfood before merging.

## Scope
- Run targeted and full validation.
- Review implementation against the attention-items design.
- Confirm no forbidden notification/wake/steer mechanisms were introduced.
- If PR finishing is requested, use the finisher flow after review and validation.

## Acceptance Criteria
- [ ] `bun run check` passes.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.
- [ ] Reviewer reports no blocking issues.
- [ ] Search confirms no new `parent_notifications`, auto-wake, auto-steer, delivery queues, ack/read state, websocket/subscription implementation.
- [ ] Dogfood evidence shows attention items in team status/result if exercised.

## Validation
```bash
bun run check
bun run typecheck
bun test
```
```
