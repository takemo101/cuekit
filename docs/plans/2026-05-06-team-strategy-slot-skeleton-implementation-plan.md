# Team Strategy Slot Skeleton Implementation Plan

> **For agentic workers:** REQUIRED: Use cuekit team strategies for non-trivial cuekit repo work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a semi-automatic `recommended_team` materialization helper that returns a coordinator-facing `submit_team_tasks` skeleton without auto-submitting worker/reviewer/finisher tasks.

**Architecture:** Add a small pure helper in `@cuekit/mcp` that converts a resolved Team Strategy and objective into structured task drafts. Extend the existing grouped `list kind=strategies` / `strategy show` detail surface to optionally include the skeleton, keeping MCP grouped and avoiding a new scheduler or flat tool. Update coordinator prompt guidance and tests so coordinators know to inspect, adjust, and submit the skeleton explicitly.

**Tech Stack:** TypeScript, Zod schemas via `incur`, Bun tests, existing `.cuekit.yaml` Team Strategy schema from `@cuekit/project-config`, existing MCP grouped `list` command and human CLI `strategy show` projection.

---

## Issue Breakdown

1. **Issue 1 — Add pure strategy slot skeleton builder**
   - Scope: new helper/schema that maps `recommended_team` slots into `submit_team_tasks` task drafts.
   - Output: tested pure function; no MCP/CLI surface yet.

2. **Issue 2 — Expose skeleton through strategy detail surfaces**
   - Scope: `list-strategies` command and grouped MCP `list kind=strategies` input schema.
   - Output: `include_task_skeleton` returns skeleton only when a specific strategy is requested; no new flat MCP tool.

3. **Issue 3 — Add CLI/MCP coverage for skeleton output**
   - Scope: CLI/integration tests for `strategy show` and MCP list detail.
   - Output: command parsing and MCP JSON output are covered end-to-end.

4. **Issue 4 — Update coordinator prompt/docs alignment**
   - Scope: prompt renderer tests and docs tweaks if implementation details differ from the current design note.
   - Output: coordinators are guided to inspect and adjust the skeleton before `submit_team_tasks`.

5. **Issue 5 — Dogfood and validate end-to-end**
   - Scope: run full validation and dogfood the skeleton with a strategy-backed team.
   - Output: evidence that a coordinator can retrieve the skeleton, edit/submit tasks manually, and final-report without auto-scheduling.

---

## Chunk 1: Pure Skeleton Builder

### Task 1: Create schema and pure builder for strategy slot materialization

**Files:**
- Create: `packages/mcp/src/team-strategy-slots.ts`
- Create: `packages/mcp/__tests__/team-strategy-slots.test.ts`
- Read: `packages/mcp/src/team-strategy.ts`
- Read: `packages/project-config/src/schema.ts`

- [ ] **Step 1: Write failing tests for slot-to-task mapping**

Create `packages/mcp/__tests__/team-strategy-slots.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { TeamStrategy } from "@cuekit/project-config";
import { buildTeamStrategyTaskSkeleton } from "../src/team-strategy-slots.ts";

const strategy: TeamStrategy = {
  recommended_team: {
    coordinator: { position: "coordinator", role: "planner", agent: "pi", model: "k2p5" },
    worker: { position: "worker", role: "worker", agent: "pi", model: "k2p5" },
    reviewer: {
      position: "reviewer",
      role: "reviewer",
      agent: "claude-code",
      model: "sonnet",
      objective: "Review the implementation diff.",
      adapter_options: { mode: "batch" },
    },
    finisher: {
      position: "finisher",
      role: "pr-finisher",
      agent: "claude-code",
      model: "sonnet",
    },
  },
};

describe("buildTeamStrategyTaskSkeleton", () => {
  it("materializes non-coordinator slots into submit_team_tasks drafts", () => {
    const skeleton = buildTeamStrategyTaskSkeleton({
      strategy_name: "feature",
      strategy,
      objective: "Implement slot skeletons.",
      team_id: "tm_123",
    });

    expect(skeleton.strategy).toBe("feature");
    expect(skeleton.team_id).toBe("tm_123");
    expect(skeleton.tasks.map((task) => task.slot)).toEqual(["finisher", "reviewer", "worker"]);
    expect(skeleton.tasks.find((task) => task.slot === "worker")).toMatchObject({
      position: "worker",
      role: "worker",
      agent_kind: "pi",
      model: "k2p5",
    });
    expect(skeleton.tasks.find((task) => task.slot === "reviewer")).toMatchObject({
      objective: "Review the implementation diff.",
      adapter_options: { mode: "batch" },
    });
    expect(skeleton.tasks.some((task) => task.position === "coordinator")).toBe(false);
  });
});
```

Rationale: the coordinator is already created by `start_team_strategy`; the skeleton should target follow-up tasks.

- [ ] **Step 2: Add failing tests for default objectives and conditional finisher metadata**

Extend the same test file:

```ts
it("generates position-aware objectives when a slot has no objective", () => {
  const skeleton = buildTeamStrategyTaskSkeleton({
    strategy_name: "feature",
    strategy,
    objective: "Implement slot skeletons.",
  });

  expect(skeleton.tasks.find((task) => task.slot === "worker")?.objective).toContain(
    "Implement or investigate the team objective",
  );
  expect(skeleton.tasks.find((task) => task.slot === "finisher")).toMatchObject({
    conditional: true,
    condition: expect.stringContaining("parent explicitly requested"),
  });
  expect(skeleton.notes).toEqual(expect.arrayContaining([
    expect.stringContaining("Review and adjust"),
    expect.stringContaining("conditional"),
  ]));
});
```

- [ ] **Step 3: Add failing tests for empty or coordinator-only teams**

```ts
it("returns an empty task list for strategies without follow-up slots", () => {
  const skeleton = buildTeamStrategyTaskSkeleton({
    strategy_name: "docs",
    strategy: { recommended_team: { coordinator: { position: "coordinator" } } },
    objective: "Docs only.",
  });

  expect(skeleton.tasks).toEqual([]);
  expect(skeleton.notes).toEqual(expect.arrayContaining([
    expect.stringContaining("No non-coordinator"),
  ]));
});
```

- [ ] **Step 4: Run the focused tests and confirm they fail**

Run:

```bash
bun test packages/mcp/__tests__/team-strategy-slots.test.ts
```

Expected: FAIL because `team-strategy-slots.ts` does not exist.

- [ ] **Step 5: Implement the minimal helper**

Create `packages/mcp/src/team-strategy-slots.ts`:

```ts
import { TeamPositionSchema } from "@cuekit/core";
import type { TeamStrategy, TeamStrategySlot } from "@cuekit/project-config";
import { z } from "incur";

export const TeamStrategyTaskSkeletonItemSchema = z.object({
  slot: z.string().min(1),
  objective: z.string().min(1),
  position: TeamPositionSchema.optional(),
  role: z.string().optional(),
  agent_kind: z.string().optional(),
  model: z.string().optional(),
  adapter_options: z.record(z.string(), z.unknown()).optional(),
  conditional: z.boolean().optional(),
  condition: z.string().optional(),
});

export const TeamStrategyTaskSkeletonSchema = z.object({
  strategy: z.string(),
  team_id: z.string().optional(),
  objective: z.string(),
  tasks: z.array(TeamStrategyTaskSkeletonItemSchema),
  notes: z.array(z.string()).optional(),
});

export type TeamStrategyTaskSkeleton = z.infer<typeof TeamStrategyTaskSkeletonSchema>;

function defaultObjective(slotName: string, slot: TeamStrategySlot, objective: string): string {
  if (slot.objective) return slot.objective;
  switch (slot.position) {
    case "worker":
      return `Implement or investigate the team objective: ${objective}`;
    case "reviewer":
      return `Review the team output for correctness, risks, and unresolved findings: ${objective}`;
    case "finisher":
      return `Verify implementation/review prerequisites, finish the requested PR/release/report-back work, and report completion: ${objective}`;
    case "observer":
      return `Observe or summarize team progress for: ${objective}`;
    default:
      return `Handle ${slotName} work for the team objective: ${objective}`;
  }
}

export function buildTeamStrategyTaskSkeleton(input: {
  strategy_name: string;
  strategy: TeamStrategy;
  objective: string;
  team_id?: string;
}): TeamStrategyTaskSkeleton {
  const tasks = Object.entries(input.strategy.recommended_team ?? {})
    .filter(([, slot]) => slot.position !== "coordinator")
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([slotName, slot]) => {
      const isFinisher = slot.position === "finisher" || slotName === "finisher";
      return {
        slot: slotName,
        objective: defaultObjective(slotName, slot, input.objective),
        ...(slot.position ? { position: slot.position } : {}),
        ...(slot.role ? { role: slot.role } : {}),
        ...(slot.agent ? { agent_kind: slot.agent } : {}),
        ...(slot.model ? { model: slot.model } : {}),
        ...(slot.adapter_options ? { adapter_options: slot.adapter_options } : {}),
        ...(isFinisher
          ? {
              conditional: true,
              condition: "Submit only if the parent explicitly requested PR/release/cleanup finishing or final report-back work.",
            }
          : {}),
      };
    });

  const notes = [
    "Review and adjust task objectives before calling submit_team_tasks; this skeleton is not auto-submitted.",
    ...(tasks.some((task) => task.conditional)
      ? ["Do not submit conditional slots unless their condition applies."]
      : []),
    ...(tasks.length === 0 ? ["No non-coordinator recommended_team slots are available to materialize."] : []),
  ];

  return {
    strategy: input.strategy_name,
    ...(input.team_id ? { team_id: input.team_id } : {}),
    objective: input.objective,
    tasks,
    notes,
  };
}
```

Adjust exact wording only if tests expect the new wording. Keep this helper pure: no DB, no submission, no task status reads.

- [ ] **Step 6: Run helper tests**

Run:

```bash
bun test packages/mcp/__tests__/team-strategy-slots.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the helper slice**

Use GitButler for version control in this repo. Commit only this slice after it passes project checks for the touched package.

---

## Chunk 2: Strategy Detail Surface

### Task 2: Add `include_task_skeleton` to strategy detail output

**Files:**
- Modify: `packages/mcp/src/commands/list-strategies.ts`
- Modify: `packages/mcp/src/operations.ts`
- Modify: `packages/mcp/__tests__/cli.test.ts`
- Test: `packages/mcp/__tests__/cli.test.ts`

- [ ] **Step 1: Write failing command-level test for `runListStrategies`**

Add a focused unit test if one exists nearby, or add to `packages/mcp/__tests__/cli.test.ts` near existing strategy detail tests. Setup a temp `.cuekit.yaml` with worker/reviewer/finisher slots, then request detail:

```ts
const res = await mcp.fetch(
  new Request(
    `http://localhost/list?kind=strategies&strategy=feature&cwd=${encodeURIComponent(root)}&objective=${encodeURIComponent("Add skeletons")}&team_id=tm_123&include_task_skeleton=true`,
  ),
);
const body = await res.json();
expect(body.ok).toBe(true);
expect(body.data.strategy.task_skeleton).toMatchObject({
  strategy: "feature",
  team_id: "tm_123",
  objective: "Add skeletons",
});
expect(body.data.strategy.task_skeleton.tasks).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ slot: "worker", position: "worker", agent_kind: "pi" }),
    expect.objectContaining({ slot: "reviewer", position: "reviewer" }),
  ]),
);
```

- [ ] **Step 2: Add failing validation test**

Add a test that `include_task_skeleton` requires `strategy`, matching the existing `include_prompt` guard:

```ts
const res = await mcp.fetch(
  new Request(`http://localhost/list?kind=strategies&cwd=${encodeURIComponent(root)}&include_task_skeleton=true`),
);
const body = await res.json();
expect(body.data.error.code).toBe("invalid_input");
expect(body.data.error.message).toContain("strategy is required");
```

- [ ] **Step 3: Run targeted tests and confirm failure**

Run:

```bash
bun test packages/mcp/__tests__/cli.test.ts --timeout 30000
```

Expected: FAIL because schemas do not accept/return `task_skeleton` yet.

- [ ] **Step 4: Extend list-strategies input and output schemas**

In `packages/mcp/src/commands/list-strategies.ts`:

- import `TeamStrategyTaskSkeletonSchema` and `buildTeamStrategyTaskSkeleton`,
- add `include_task_skeleton: z.boolean().optional()`,
- add `team_id: z.string().min(1).optional()`,
- extend `StrategyDetailSchema` with `task_skeleton: TeamStrategyTaskSkeletonSchema.optional()`,
- update validation guard:

```ts
if (!input.strategy && (input.include_prompt || input.objective || input.include_task_skeleton || input.team_id)) {
  return {
    error: {
      code: "invalid_input",
      message: "strategy is required when include_prompt, include_task_skeleton, objective, or team_id is provided",
    },
  };
}
```

- only build skeleton when `input.include_task_skeleton` is true:

```ts
...(input.include_task_skeleton
  ? {
      task_skeleton: buildTeamStrategyTaskSkeleton({
        strategy_name: resolved.strategy_name,
        strategy: resolved.strategy,
        objective: input.objective ?? "Coordinate this strategy-backed team.",
        ...(input.team_id ? { team_id: input.team_id } : {}),
      }),
    }
  : {}),
```

- [ ] **Step 5: Extend grouped MCP list schema**

In `packages/mcp/src/operations.ts`, update `ListInputSchema` with:

```ts
include_task_skeleton: z
  .boolean()
  .optional()
  .describe("Include a coordinator-facing submit_team_tasks skeleton when kind is strategies and strategy is set."),
team_id: z.string().min(1).optional().describe("Team id used in strategy task skeleton output."),
```

There is already a `team_id` field for tasks filtering. Keep one field and update its description to cover both uses rather than duplicating it.

- [ ] **Step 6: Run targeted tests**

Run:

```bash
bun test packages/mcp/__tests__/cli.test.ts --timeout 30000
```

Expected: PASS.

- [ ] **Step 7: Commit the surface slice**

Commit with a focused message such as `feat: expose strategy task skeletons`.

---

## Chunk 3: CLI and Prompt Alignment

### Task 3: Make strategy show and coordinator prompt advertise skeleton usage

**Files:**
- Modify: `packages/mcp/src/team-strategy.ts`
- Modify: `packages/mcp/__tests__/team-strategy.test.ts`
- Modify: `packages/mcp/__tests__/cli.test.ts`
- Modify: `docs/designs/cuekit-team-strategies-design.md` if implementation details differ

- [ ] **Step 1: Write failing prompt test**

In `packages/mcp/__tests__/team-strategy.test.ts`, extend the coordinator prompt test:

```ts
expect(prompt).toContain("recommended team skeleton");
expect(prompt).toContain("review and adjust it before submit_team_tasks");
expect(prompt).toContain("Cuekit will not auto-submit worker/reviewer tasks");
```

- [ ] **Step 2: Update prompt text minimally**

In `packages/mcp/src/team-strategy.ts`, replace the current generic coordination sentence with wording like:

```ts
"Use cuekit tools to coordinate: inspect the strategy's recommended team skeleton when useful, review and adjust it before submit_team_tasks, wait with follow_new_tasks, steer when needed, get_team_result, and report a final completed event. Cuekit will not auto-submit worker/reviewer tasks from the skeleton."
```

Keep no-scheduler/no-auto-routing semantics. Do not imply task drafts are mandatory.

- [ ] **Step 3: Add CLI parsing test for human `strategy show`**

In `packages/mcp/__tests__/cli.test.ts`, add or extend a strategy show test that calls the CLI path with JSON-ish options supported by `incur`, for example:

```bash
cuekit strategy show --strategy feature --cwd <root> --objective "Add skeletons" --team-id tm_123 --include-task-skeleton true --format json
```

Assert the output includes `strategy.task_skeleton.tasks` with `position` values.

If exact CLI boolean flag syntax differs, inspect existing tests for `include_prompt` and mirror that pattern.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
bun test packages/mcp/__tests__/team-strategy.test.ts packages/mcp/__tests__/cli.test.ts --timeout 30000
```

Expected: PASS.

- [ ] **Step 5: Commit prompt/CLI alignment**

Commit after tests pass.

---

## Chunk 4: Validation and Dogfood

### Task 4: Validate and dogfood the semi-automatic flow

**Files:**
- Potentially modify: `docs/designs/cuekit-team-strategies-design.md`
- Potentially modify: `.cuekit.yaml` only if dogfood reveals config examples need adjustment

- [ ] **Step 1: Run full validation**

Run:

```bash
bun run fix
bun run check
bun run typecheck
bun test
```

Expected: all pass.

- [ ] **Step 2: Dogfood strategy skeleton retrieval**

Use cuekit MCP or CLI to request a strategy detail skeleton for an existing strategy:

```bash
cuekit strategy show --strategy feature --objective "Dogfood strategy skeleton materialization" --cwd . --include-task-skeleton true --format json
```

Expected:

- output includes worker/reviewer/finisher slots where configured,
- `position` is present on slot-derived tasks,
- `agent` is emitted as `agent_kind`,
- `finisher` is conditional and not auto-submitted.

- [ ] **Step 3: Dogfood coordinator usage without auto-submit**

Start a small docs-polish or dogfood strategy team and instruct the coordinator to inspect the skeleton, choose one safe worker/reviewer task, and final-report. Confirm that workers/reviewers are created only by explicit `submit_team_tasks` and not by `start_team_strategy`.

- [ ] **Step 4: Capture findings**

If dogfood reveals wording or schema issues, make tiny follow-up fixes and rerun targeted tests. Do not add auto-scheduling or automatic validation.

- [ ] **Step 5: Final evidence**

Final report should include:

- changed files,
- test commands and results,
- dogfood team id(s),
- confirmation that no scheduler/auto-routing/auto-submit was added,
- known follow-ups, if any.

---

## Acceptance Criteria

- `recommended_team` can be materialized into a structured `submit_team_tasks` skeleton.
- Skeleton output is data-only and never submits tasks.
- Coordinator slot is excluded from follow-up task drafts because `start_team_strategy` already creates it.
- Slot `agent` maps to task draft `agent_kind`.
- Slot-derived `position` is preserved so lanes remain visible.
- Finisher drafts are marked conditional and have actionable task instructions.
- Grouped MCP `cuekit_list kind=strategies` can return the skeleton for a specific strategy.
- Human CLI strategy detail can return the same skeleton.
- Coordinator prompt tells agents to inspect, adjust, and explicitly submit skeleton tasks.
- Full validation passes: `bun run check`, `bun run typecheck`, `bun test`.

## Non-Goals

- Do not auto-create worker/reviewer/finisher tasks in `start_team_strategy`.
- Do not add a flat MCP tool for this helper unless grouped strategy detail proves insufficient.
- Do not add DAG scheduling, dependencies, message routing, auto-wake, or auto-steer.
- Do not execute strategy `checks` automatically.
