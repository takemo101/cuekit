# Finisher Position and Coordinator Routing Implementation Plan

> **For agentic workers:** REQUIRED: Use cuekit team strategies for non-trivial cuekit repo work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `position: finisher` a first-class cuekit team position, then surface finisher report-back evidence through existing durable `task_events` based team result/status views without adding auto-wake or auto-steer behavior.

**Architecture:** Implement this in small slices. First extend shared schemas/config/default-role resolution so `finisher` is accepted everywhere a `TeamPosition` is valid. Then update MCP grouping/result surfaces and strategy prompts so finisher reports are grouped separately from reviewers. Finally update repo strategies/docs caveats and add a minimal coordinator report-back surface over existing `task_events`; no new notification table, delivery queue, ack state, or push mechanism.

**Tech Stack:** TypeScript, Zod schemas, Bun tests, cuekit MCP commands, project-config YAML parsing, existing SQLite `task_events` summaries.

---

## Issue Breakdown

1. **Issue 1 — Accept `position: finisher` in core and project config schemas**
   - Scope: shared `TeamPositionSchema`, project config strategy/role schemas, default role resolution.
   - Output: `finisher` validates in task specs, team task submission inputs, strategy config, and `teams.roles` defaults.

2. **Issue 2 — Group finisher separately in MCP team status/result/run summaries**
   - Scope: grouping helpers and MCP command outputs.
   - Output: `run_summary.positions.finisher` exists and finisher terminal reports do not appear under `reviewer`.

3. **Issue 3 — Apply `position: finisher` to repo strategies and docs caveats**
   - Scope: `.cuekit.yaml` and documentation cleanup after schema support lands.
   - Output: builtin dogfood strategies use `position: finisher`; docs no longer say it is unsupported by the current schema.

4. **Issue 4 — Add minimal coordinator report-back guidance over existing team results**
   - Scope: coordinator prompt rendering and result wording/highlighting only.
   - Output: coordinators are instructed to inspect finisher terminal reports via `get_team_result`; no auto-wake/auto-steer is introduced.

5. **Issue 5 — End-to-end dogfood validation and PR finishing flow**
   - Scope: strategy-backed team run that exercises finisher slot and validates no regressions.
   - Output: full checks pass, reviewer approves, and PR finisher can complete the requested PR flow.

---

## Chunk 1: Core and Project Config Schema

### Task 1: Extend shared `TeamPosition` schema

**Files:**
- Modify: `packages/core/src/team.ts`
- Modify: `packages/core/__tests__/schemas.test.ts`

- [ ] **Step 1: Write the failing schema test**

Add an assertion near the existing known position tests:

```ts
expect(TeamPositionSchema.safeParse("finisher").success).toBe(true);
```

Keep the existing invalid `manager` assertion.

- [ ] **Step 2: Run the targeted test and confirm failure**

Run:

```bash
bun test packages/core/__tests__/schemas.test.ts
```

Expected: FAIL because `finisher` is not in `TeamPositionSchema` yet.

- [ ] **Step 3: Implement the schema change**

Change:

```ts
export const TeamPositionSchema = z.enum(["coordinator", "worker", "reviewer", "observer"]);
```

to:

```ts
export const TeamPositionSchema = z.enum([
  "coordinator",
  "worker",
  "reviewer",
  "finisher",
  "observer",
]);
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
bun test packages/core/__tests__/schemas.test.ts
```

Expected: PASS.

### Task 2: Extend project config accepted positions and role defaults

**Files:**
- Modify: `packages/project-config/src/apply.ts`
- Modify: `packages/project-config/src/schema.ts` if it has a local enum/list rather than importing the core schema
- Modify: `packages/project-config/__tests__/schema.test.ts`
- Modify: `packages/project-config/__tests__/apply.test.ts`

- [ ] **Step 1: Write failing config schema tests**

Add or update tests so this config parses:

```ts
const parsed = ProjectConfigSchema.parse({
  teams: { roles: { finisher: "pr-finisher" } },
  strategies: {
    dogfood: {
      recommended_team: {
        finisher: { position: "finisher", role: "pr-finisher" },
      },
    },
  },
});
expect(parsed.teams?.roles?.finisher).toBe("pr-finisher");
expect(parsed.strategies?.dogfood?.recommended_team?.finisher?.position).toBe("finisher");
```

- [ ] **Step 2: Write failing apply/default-role test**

Add a test for default role lookup:

```ts
const config = { teams: { roles: { finisher: "pr-finisher" } } };
expect(applyProjectDefaults(config, { position: "finisher" })).toMatchObject({
  role: "pr-finisher",
});
```

Use the existing helper/function names in `packages/project-config/__tests__/apply.test.ts`; do not invent a new public API.

- [ ] **Step 3: Run targeted tests and confirm failure**

Run:

```bash
bun test packages/project-config/__tests__/schema.test.ts packages/project-config/__tests__/apply.test.ts
```

Expected: FAIL on `finisher` validation/default role typing.

- [ ] **Step 4: Implement project config changes**

- Add `finisher` to the local `TeamPosition` union in `packages/project-config/src/apply.ts`.
- If `packages/project-config/src/schema.ts` has a local `StrategyPositionSchema`, add `finisher` there too.
- Ensure `teams.roles.finisher` is allowed if roles are enumerated.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
bun test packages/project-config/__tests__/schema.test.ts packages/project-config/__tests__/apply.test.ts
```

Expected: PASS.

---

## Chunk 2: MCP Team Summary and Result Surfaces

### Task 3: Add `finisher` to team grouping helpers

**Files:**
- Modify: `packages/mcp/src/team-status.ts`
- Modify: `packages/mcp/__tests__/team-status.test.ts`

- [ ] **Step 1: Write failing grouping test**

Extend `groups task summaries by team position` with a finisher task:

```ts
{ task_id: "t5", agent_kind: "pi", status: "completed", position: "finisher", updated_at: now }
```

Assert:

```ts
expect(grouped.finisher.map((task) => task.task_id)).toEqual(["t5"]);
expect(grouped.reviewer.map((task) => task.task_id)).toEqual(["t3"]);
```

- [ ] **Step 2: Run targeted test and confirm failure**

Run:

```bash
bun test packages/mcp/__tests__/team-status.test.ts
```

Expected: FAIL because `finisher` is not initialized/grouped.

- [ ] **Step 3: Implement grouping change**

Add `finisher` to the `POSITIONS` list and empty grouped record in `packages/mcp/src/team-status.ts`.

- [ ] **Step 4: Run targeted test**

Run:

```bash
bun test packages/mcp/__tests__/team-status.test.ts
```

Expected: PASS.

### Task 4: Add `finisher` to run summaries and command outputs

**Files:**
- Modify: `packages/mcp/src/team-run-summary.ts`
- Modify: `packages/mcp/src/commands/get-team-status.ts` if output schema assumptions need updates
- Modify: `packages/mcp/src/commands/get-team-result.ts` if timeline/result schemas need updates
- Modify: `packages/mcp/__tests__/commands.test.ts`

- [ ] **Step 1: Write failing run summary test**

Add or extend a test in `packages/mcp/__tests__/commands.test.ts` with tasks/events:

```ts
team_position: "finisher",
```

and a terminal event message like:

```ts
"PR merged and branch cleaned up"
```

Assert:

```ts
expect(result.run_summary.positions.finisher[0]?.message).toBe("PR merged and branch cleaned up");
expect(result.run_summary.positions.reviewer).toEqual([]);
```

- [ ] **Step 2: Write failing `get_team_result` timeline test**

Ensure a finisher task terminal event appears with `position: "finisher"` in the result timeline, separate from reviewer events.

- [ ] **Step 3: Run targeted MCP tests and confirm failure**

Run:

```bash
bun test packages/mcp/__tests__/commands.test.ts
```

Expected: FAIL before `finisher` is added to summary position lists.

- [ ] **Step 4: Implement run summary changes**

- Add `finisher` to `POSITIONS` in `packages/mcp/src/team-run-summary.ts`.
- Ensure `emptyPositions()` initializes `finisher: []`.
- Ensure sorting/truncation loops include finisher naturally.
- Avoid special-casing `role: pr-finisher`; the grouping must be by `team_position`.

- [ ] **Step 5: Run targeted MCP tests**

Run:

```bash
bun test packages/mcp/__tests__/commands.test.ts
```

Expected: PASS.

---

## Chunk 3: Strategy Config, Repo Strategy, and Docs Alignment

### Task 5: Update strategy rendering tests for finisher slots

**Files:**
- Modify: `packages/mcp/__tests__/team-strategy.test.ts`
- Modify: `packages/mcp/src/team-strategy.ts` only if tests reveal wording gaps

- [ ] **Step 1: Write/update strategy prompt test**

Add a `finisher` slot to the strategy fixture:

```ts
finisher: {
  position: "finisher",
  role: "pr-finisher",
  agent: "claude-code",
  model: "sonnet",
  objective: "Finish PR flow after validation and review",
},
```

Assert prompt contains:

```ts
expect(prompt).toContain("finisher: position finisher, role pr-finisher");
expect(prompt).toContain("After a `position: finisher` task completes");
```

Use exact expected wording that matches the implemented prompt style.

- [ ] **Step 2: Run targeted test**

Run:

```bash
bun test packages/mcp/__tests__/team-strategy.test.ts
```

Expected: PASS if prior docs-guidance implementation already covers this; otherwise FAIL and then update rendering text.

### Task 6: Update `.cuekit.yaml` strategies

**Files:**
- Modify: `.cuekit.yaml`
- Test: `packages/project-config/__tests__/schema.test.ts` or CLI/config loading tests if present

- [ ] **Step 1: Replace finisher slot positions**

For every strategy finisher slot, change:

```yaml
position: reviewer
role: pr-finisher
```

to:

```yaml
position: finisher
role: pr-finisher
```

Only change slots that are semantically finishers; leave normal reviewer slots as `position: reviewer`.

- [ ] **Step 2: Validate config parsing**

Run the most relevant config/strategy tests:

```bash
bun test packages/project-config/__tests__/schema.test.ts packages/mcp/__tests__/team-strategy.test.ts
```

Expected: PASS.

### Task 7: Remove outdated docs caveats after implementation

**Files:**
- Modify: `docs/designs/cuekit-project-config-design.md`
- Modify: `docs/designs/cuekit-task-teams-design.md`
- Modify: `docs/guides/project-config.md`
- Modify: `docs/designs/cuekit-coordinator-notifications-routing-design.md` only if implementation wording changes

- [ ] **Step 1: Search for stale caveats**

Run:

```bash
rg -n "current released schema|Current implementation still accepts|schema slice lands|planned; accepted|first-class finisher schema" docs .cuekit.yaml
```

- [ ] **Step 2: Update docs to implementation-present wording**

Examples:

- Replace “current released schema may not yet accept `finisher`” with “`finisher` is accepted as a first-class team position.”
- Remove inline YAML comments saying the finisher role default is planned/not-yet-accepted.
- Keep design-history context if useful, but avoid warning users away from a now-supported feature.

- [ ] **Step 3: Run docs formatting/check**

Run:

```bash
bun run check
```

Expected: PASS.

---

## Chunk 4: Minimal Coordinator Report-Back Routing

### Task 8: Highlight finisher terminal evidence in team results without new routing infrastructure

**Files:**
- Modify: `packages/mcp/src/commands/get-team-result.ts`
- Modify: `packages/mcp/src/team-run-summary.ts` if result text comes from shared summary
- Modify: `packages/mcp/__tests__/commands.test.ts`

- [ ] **Step 1: Write failing test for finisher evidence visibility**

Create a team with:

- worker completed report,
- reviewer completed report,
- finisher completed report with PR/merge evidence.

Assert `get_team_result` includes the finisher event in a clearly addressable way, e.g. timeline event position is `finisher` and/or `run_summary.positions.finisher` includes the message.

Do **not** require a new MCP tool or notification table.

- [ ] **Step 2: Run targeted test**

Run:

```bash
bun test packages/mcp/__tests__/commands.test.ts
```

Expected: FAIL only if current result surface does not expose the finisher evidence cleanly enough.

- [ ] **Step 3: Implement minimal result-surface improvement**

Acceptable changes:

- ensure finisher terminal reports are in `run_summary.positions.finisher`,
- ensure `timeline` entries include `position: "finisher"`,
- optionally add a small `final_flow`/`finisher_reports` derived field only if existing fields are insufficient.

Avoid:

- `parent_notifications` table,
- ack/delivery queues,
- background wake/resume,
- auto-steer rules.

- [ ] **Step 4: Run targeted test**

Run:

```bash
bun test packages/mcp/__tests__/commands.test.ts
```

Expected: PASS.

### Task 9: Ensure coordinator guidance is prompt-only and no auto-wake/auto-steer exists

**Files:**
- Modify: `packages/mcp/src/team-strategy.ts`
- Modify: `packages/mcp/__tests__/team-strategy.test.ts`
- Modify: docs if wording needs alignment

- [ ] **Step 1: Write or update prompt test**

Assert the rendered strategy/coordinator prompt includes:

```text
After a `position: finisher` task completes, inspect the team result with get_team_result
```

and does not imply automatic team completion.

- [ ] **Step 2: Search for accidental automation hooks**

Run:

```bash
rg -n "wake|auto-steer|parent_notifications|ack|delivery queue|subscribe|websocket" packages docs/designs/cuekit-coordinator-notifications-routing-design.md
```

Expected: no new implementation hooks; docs may mention these only as non-goals.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
bun test packages/mcp/__tests__/team-strategy.test.ts packages/mcp/__tests__/commands.test.ts
```

Expected: PASS.

---

## Chunk 5: Validation, Dogfood, and PR Finish

### Task 10: Full validation

**Files:**
- No planned source edits unless validation finds issues.

- [ ] **Step 1: Run whitespace check**

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 2: Run formatter/linter check**

```bash
bun run check
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

```bash
bun test
```

Expected: PASS.

### Task 11: Strategy-backed dogfood review

**Files:**
- No planned source edits unless review finds issues.

- [ ] **Step 1: Start a cuekit strategy team**

Use `cuekit_start_team_strategy` with an appropriate strategy (`feature` or `dogfood`) and a concise objective:

```text
Implement first-class position: finisher and minimal coordinator report-back routing over existing task_events. Validate schema/config/MCP summary behavior and docs alignment. Do not add auto-wake/auto-steer.
```

- [ ] **Step 2: Submit/ensure reviewer task**

Reviewer should check:

- `finisher` is accepted in schemas/config,
- finisher reports group separately from reviewer,
- no role-specific `pr-finisher` special casing is used for generic position behavior,
- no automatic wake/steer/notification queue was introduced,
- docs match implementation.

- [ ] **Step 3: Address reviewer findings**

Apply only necessary changes and rerun targeted tests.

- [ ] **Step 4: Final validation**

Rerun:

```bash
bun run check
bun run typecheck
bun test
```

Expected: all PASS.

### Task 12: PR finishing flow

**Files:**
- No source edits expected unless PR finisher finds release/cleanup issues.

- [ ] **Step 1: Create a PR after validation/review**

Use project VCS instructions. In this environment, prefer `but` for branch/status/commit/push operations and `gh` for PR operations.

- [ ] **Step 2: Use finisher role/slot only when PR creation/merge is explicitly requested**

The finisher should report evidence:

- changed files summary,
- validation commands and results,
- PR URL,
- merge status if merge was requested,
- cleanup status.

- [ ] **Step 3: Cleanup cuekit tasks/team**

After terminal reports are captured and no further inspection is needed, use cuekit cleanup for terminal tasks/teams.

---

## Suggested GitHub Issue Bodies

### Issue 1: Accept first-class `position: finisher` in schemas/config

```markdown
## Goal
Accept `position: finisher` everywhere cuekit accepts a team position, including core task schemas, project config strategy slots, and `teams.roles` defaults.

## Scope
- Extend `TeamPositionSchema` with `finisher`.
- Extend project config position validation/default-role typing with `finisher`.
- Allow `teams.roles.finisher: pr-finisher`.
- Allow `strategies.<name>.recommended_team.<slot>.position: finisher`.

## Files
- `packages/core/src/team.ts`
- `packages/core/__tests__/schemas.test.ts`
- `packages/project-config/src/apply.ts`
- `packages/project-config/src/schema.ts`
- `packages/project-config/__tests__/schema.test.ts`
- `packages/project-config/__tests__/apply.test.ts`

## Acceptance Criteria
- `TeamPositionSchema.safeParse("finisher").success === true`.
- Project config parses `teams.roles.finisher`.
- Project config parses a strategy `recommended_team.finisher.position: finisher`.
- Role defaults map `position: finisher` to configured `teams.roles.finisher`.
- Invalid positions such as `manager` still fail.

## Validation
```bash
bun test packages/core/__tests__/schemas.test.ts
bun test packages/project-config/__tests__/schema.test.ts packages/project-config/__tests__/apply.test.ts
```
```

### Issue 2: Group `finisher` separately in MCP team status/result summaries

```markdown
## Goal
Expose `position: finisher` as its own lane in MCP team status, wait, and result summaries instead of mixing it with reviewers.

## Scope
- Add `finisher` to team grouping helpers.
- Ensure `run_summary.positions.finisher` exists.
- Ensure finisher terminal reports appear under `finisher`, not `reviewer`.
- Ensure `get_team_result` timeline preserves `position: finisher`.

## Files
- `packages/mcp/src/team-status.ts`
- `packages/mcp/src/team-run-summary.ts`
- `packages/mcp/src/commands/get-team-status.ts`
- `packages/mcp/src/commands/get-team-result.ts`
- `packages/mcp/src/commands/wait-team.ts`
- `packages/mcp/__tests__/team-status.test.ts`
- `packages/mcp/__tests__/commands.test.ts`

## Acceptance Criteria
- `groupTasksByPosition()` returns `finisher: []` even when empty.
- A finisher task is grouped into `positions.finisher`.
- A finisher terminal report is visible in `run_summary.positions.finisher`.
- Reviewer reports remain in `positions.reviewer` only.
- No behavior depends on `role: pr-finisher`; grouping is by `team_position`.

## Validation
```bash
bun test packages/mcp/__tests__/team-status.test.ts
bun test packages/mcp/__tests__/commands.test.ts
```
```

### Issue 3: Update strategies and docs after `position: finisher` is implemented

```markdown
## Goal
Make repo strategies and user docs reflect that `position: finisher` is now implemented, not just planned.

## Scope
- Update `.cuekit.yaml` finisher slots to use `position: finisher`.
- Remove outdated docs caveats saying current schema may not accept `finisher`.
- Keep docs clear that `role: pr-finisher` is PR-specific while `position: finisher` is the generic finalization lane.

## Files
- `.cuekit.yaml`
- `docs/designs/cuekit-project-config-design.md`
- `docs/designs/cuekit-task-teams-design.md`
- `docs/designs/cuekit-team-strategies-design.md`
- `docs/designs/cuekit-pr-finisher-profile-design.md`
- `docs/guides/project-config.md`
- `docs/README.md`
- `docs/designs/README.md`

## Acceptance Criteria
- All semantic finisher slots use `position: finisher` and `role: pr-finisher`.
- Normal reviewer slots still use `position: reviewer`.
- Docs no longer describe `finisher` as rejected by the current implementation.
- Docs preserve the non-goal that cuekit does not automatically create/merge PRs.

## Validation
```bash
rg -n "current released schema|Current implementation still accepts|schema slice lands|planned; accepted|position: reviewer\n\s+role: pr-finisher" docs .cuekit.yaml
bun run check
```
```

### Issue 4: Add minimal coordinator report-back guidance over existing team results

```markdown
## Goal
Help coordinators notice finisher terminal reports through existing durable `task_events`/team result surfaces, without adding auto-wake, auto-steer, delivery queues, or ack state.

## Scope
- Ensure strategy/coordinator prompt guidance tells coordinators to inspect `get_team_result` after a `position: finisher` task completes.
- Ensure `get_team_result`/run summaries make finisher terminal evidence easy to find.
- Do not add a new notification table, push service, subscription mechanism, ack table, or wake/steer automation.

## Files
- `packages/mcp/src/team-strategy.ts`
- `packages/mcp/src/team-run-summary.ts`
- `packages/mcp/src/commands/get-team-result.ts`
- `packages/mcp/__tests__/team-strategy.test.ts`
- `packages/mcp/__tests__/commands.test.ts`
- `docs/designs/cuekit-coordinator-notifications-routing-design.md`

## Acceptance Criteria
- Rendered coordinator strategy prompt includes guidance equivalent to: after a `position: finisher` task completes, inspect `get_team_result` and emit the coordinator final report.
- Finisher terminal reports are visible in existing result/status outputs.
- No `parent_notifications`, ack/delivery queue, websocket/subscription, auto-wake, or auto-steer implementation is introduced.
- The design remains compatible with ADR 001: `task_events` is the canonical durable report stream.

## Validation
```bash
bun test packages/mcp/__tests__/team-strategy.test.ts packages/mcp/__tests__/commands.test.ts
rg -n "parent_notifications|auto-steer|wake|ack|delivery queue|websocket|subscribe" packages
```
```

### Issue 5: Dogfood first-class finisher end-to-end and finish PR

```markdown
## Goal
Validate the first-class finisher implementation with a strategy-backed cuekit team and complete the PR flow only after tests/review pass.

## Scope
- Run a cuekit strategy-backed implementation/review flow.
- Validate schema/config/MCP behavior end-to-end.
- Use reviewer task for blocking review.
- If requested, use the finisher role/slot for PR creation/merge/cleanup.

## Acceptance Criteria
- `bun run check` passes.
- `bun run typecheck` passes.
- `bun test` passes.
- cuekit reviewer reports no blocking issues.
- Team result shows finisher reports under `positions.finisher` during dogfood, if a finisher task is submitted.
- PR URL and validation evidence are reported.

## Validation
```bash
bun run check
bun run typecheck
bun test
```
```
