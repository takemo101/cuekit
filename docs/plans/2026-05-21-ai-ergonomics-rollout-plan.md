# AI Ergonomics & Coordinator Quality Rollout Plan

> **For agentic workers:** REQUIRED: Use cuekit dogfood where useful. Implement each task with TDD, request code review before PR merge, and rebuild `bin/cuekit.js` with `bun run bundle` after source changes. Phases ship as independent PRs. Do **not** combine phases into a single PR — keep blast radius bounded.

**Goal:** Implement the seven-area design at [`docs/designs/cuekit-ai-ergonomics-design.md`](../designs/cuekit-ai-ergonomics-design.md) in five PR-sized phases, so AI agents (especially coordinators) reach for cuekit frequently and reliably without depending on prompt-following heroics.

**Architecture:** Each phase is independent and additive (except Phase 1's `include_blackboard` default flip). Phases 1–3 are mostly schema and resolver work in `@cuekit/mcp` and `@cuekit/project-config`. Phase 4 touches `@cuekit/core` to add structured outcomes. Phase 5 contains the deeper coordinator-prompt rewrite and lifecycle safety bits. The TUI absorbs new response fields automatically; explicit TUI render improvements are deferred to follow-up work.

**Tech Stack:** Bun, TypeScript, Zod schemas, SQLite via `@cuekit/store`, MCP via `incur`, existing test infrastructure (`FakeTmuxRunner`, `FakeHerdrRunner`).

---

## File Structure

Across all phases:

- `packages/mcp/src/commands/`
  - `submit-task.ts` — defaults resolution (1.2), idempotency (2.2), strategy hint (5.2)
  - `submit-tasks.ts` *(new)* — batch submission (2.1)
  - `submit-team-tasks.ts` — share idempotency + defaults resolution helpers
  - `start-team-strategy.ts` — flat `coordinator_*` fields (1.3)
  - `steer-task.ts` / `steer-team.ts` — `include_blackboard` default flip (3.1), optional echo verify (3.2)
  - `report-task-event.ts` — `event_type` relaxation (1.1), structured `outcome` (7.2)
  - `wait-team.ts` / `wait-tasks.ts` — `must_inspect` flag (5.3)
  - `get-team-snapshot.ts` / `get-task-snapshot.ts` — `team_metrics` (5.1)
  - `cleanup-tasks.ts` / `cleanup-team.ts` — time-based auto-cleanup (4.2)
- `packages/mcp/src/operations.ts`
  - Register `submit_tasks` grouped tool (2.1); update tool descriptions (6.2)
- `packages/mcp/src/team-strategy.ts`
  - Shrink `renderTeamStrategyPrompt` after Phase 1+3+5 land (6.1)
- `packages/mcp/src/team-blackboard.ts` *(or equivalent)*
  - Default `include_blackboard` resolution helper (3.1)
- `packages/mcp/src/coordinator-decision-counter.ts` *(new)*
  - Per-coordinator decision count (7.1)
- `packages/project-config/src/schema.ts`
  - `submit.max_concurrent_tasks`, `teams.max_workers_per_team` (4.1)
  - `submit.idempotency_window_ms` (2.2)
  - `teams.cleanup_terminal_after_hours` (4.2)
  - `coordinator.max_decisions` (7.1)
- `packages/project-config/src/defaults.ts`
  - Default values for new keys (4.1, 4.2, 7.1)
- `packages/core/src/`
  - `event_type` schema relaxation (1.1)
  - `OutcomeSchema` for structured outcomes (7.2)
- `packages/store/src/task-store.ts`
  - `idempotency_key` column + index on `tasks` (2.2)
  - `outcome` payload storage on terminal events (7.2)
- `packages/store/migrations/`
  - New migration for idempotency + outcome columns
- `packages/mcp/__tests__/commands.test.ts`
  - Per-phase test additions
- `packages/mcp/__tests__/team-strategy.test.ts`
  - Update prompt assertions when Phase 5 shrinks the prompt
- `packages/project-config/__tests__/schema.test.ts`
  - New `.cuekit.yaml` key validation
- `bin/cuekit.js`
  - Rebuilt bundle after each phase
- `packages/cli/bin/cuekit.js`
  - Sync with `bin/cuekit.js` after each phase

---

## Phase 1 — Quick wins (low-risk, prompt independence)

**Single PR.** Targeted at removing the highest-friction items observed in C-1 dogfood verification.

### Issue 1.1: Relax `report` `event_type` enum

**Purpose:** Accept any non-empty string as `event_type` so coordinators don't fall back to semantically wrong labels.

**Files:**
- Modify: `packages/core/src/` (locate `EventTypeSchema` or equivalent)
- Modify: `packages/mcp/src/commands/report-task-event.ts` (and `report-team-event.ts` if separate)
- Test: `packages/mcp/__tests__/commands.test.ts`
- Test: `packages/core/__tests__/` (if event_type schema lives there)

**Acceptance:**
- `report({ event_type: "note", ... })` succeeds and stores the value verbatim.
- `report({ event_type: "checkpoint", ... })` succeeds.
- `report({ event_type: "" })` still fails with a clear validation error.
- Existing curated values (`started`, `completed`, etc.) continue to work unchanged.
- `list({ kind: "events" })` returns events with the new `event_type` strings intact.

**Steps:**
- [ ] **Step 1:** Write failing tests for `event_type: "note"` and `event_type: "checkpoint"` against `runReportTaskEvent`.
- [ ] **Step 2:** Find the strict enum in `@cuekit/core` and replace with `z.string().min(1)`. Keep a `KNOWN_EVENT_TYPES` constant for TUI / filtering use.
- [ ] **Step 3:** Confirm `list({kind:"events"})` round-trips the new values.
- [ ] **Step 4:** Update doc comments noting the relaxation.

### Issue 1.2: Flat `coordinator_*` fields on `start_team_strategy`

**Purpose:** Let callers pass `coordinator_agent_kind` / `coordinator_model` / `coordinator_role` / `coordinator_timeout_ms` directly instead of a JSON-stringified object.

**Files:**
- Modify: `packages/mcp/src/commands/start-team-strategy.ts`
- Modify: `packages/cli/src/` *(CLI flag wiring, if exposed by `cuekit team start`)*
- Test: `packages/mcp/__tests__/commands.test.ts`

**Acceptance:**
- `start_team_strategy({ ..., coordinator_agent_kind: "claude-code", coordinator_model: "sonnet" })` works.
- Existing `coordinator: { agent_kind, model, ... }` object form still works.
- If both flat and object are provided, the object form wins (explicit beats inferred); document this in the schema description.
- CLI gains `--coordinator-agent-kind`, `--coordinator-model`, `--coordinator-role`, `--coordinator-timeout-ms`.

**Steps:**
- [ ] **Step 1:** Add the flat fields to `StartTeamStrategyInputSchema` as optional.
- [ ] **Step 2:** Pre-merge logic: if `coordinator` object is unset, build it from the flat fields. If object is set, ignore flat fields (with a `defaults_applied` note).
- [ ] **Step 3:** Add CLI flags and verify the dispatcher.
- [ ] **Step 4:** Tests covering flat-only, object-only, both-set, and neither.

### Issue 1.3: Flip `include_blackboard` default for team-kind steers

**Purpose:** Move the prompt-nudged behaviour into an API default so it works regardless of LLM size.

**Files:**
- Modify: `packages/mcp/src/commands/steer-team.ts`
- Modify: `packages/mcp/src/team-strategy.ts` (update the prompt line from "prefer ... true" to "the default is true; pass false to opt out")
- Test: `packages/mcp/__tests__/commands.test.ts`
- Test: `packages/mcp/__tests__/team-strategy.test.ts` (assertion text changes)

**Acceptance:**
- `steer({ kind: "team", team_id, message })` without `include_blackboard` attaches recent blackboard events to the steered message.
- `steer({ kind: "team_position", ... })` and `steer({ kind: "team_tasks", ... })` behave the same.
- `steer({ kind: "task", ... })` keeps `false` as default (per-task steers usually have local context already).
- Explicit `include_blackboard: false` is honoured.
- The team-strategy prompt line is updated to describe the default rather than encourage opt-in.

**Steps:**
- [ ] **Step 1:** Update tests to assert the new default behaviour and the prompt text change.
- [ ] **Step 2:** Default `include_blackboard` to `true` when `kind ∈ {team, team_position, team_tasks}` in `SteerTeamInputSchema` (or in the resolver before passing to `buildBlackboardAttachment`).
- [ ] **Step 3:** Rewrite the relevant line in `renderTeamStrategyPrompt`.

### Issue 1.4: Tool description rewrites (when-to-use)

**Purpose:** Rewrite grouped MCP tool descriptions to lead with *when to use* rather than *what it is*.

**Files:**
- Modify: `packages/mcp/src/commands/submit-task.ts` — top-level tool description
- Modify: `packages/mcp/src/commands/steer-task.ts` / `steer-team.ts`
- Modify: `packages/mcp/src/commands/wait-tasks.ts` / `wait-team.ts`
- Modify: `packages/mcp/src/commands/get-task-snapshot.ts` / `get-team-snapshot.ts`
- Modify: `packages/mcp/src/operations.ts` — grouped tool projection metadata
- Test: `packages/mcp/__tests__/commands.test.ts` — schema description smoke assertions

**Acceptance:**
- Every grouped MCP tool's top-level description starts with "Use when…" or equivalent.
- Tool descriptions list **alternatives** ("for multiple parallel sub-tasks, prefer `submit_tasks`") to guide AI to the right tool.
- Schema description text is asserted in tests so regression is caught.

**Steps:**
- [ ] **Step 1:** Draft the new description text for each tool (target ~80–120 chars; not a novel).
- [ ] **Step 2:** Replace `.describe()` calls in each `Input*Schema`.
- [ ] **Step 3:** Add smoke assertions that the description contains key phrases.

### Phase 1 wrap

- [ ] `bun run bundle` and `cp bin/cuekit.js packages/cli/bin/cuekit.js`.
- [ ] `bun run typecheck` and `bun test` and `bun run check` all pass.
- [ ] Open PR titled `feat(mcp): Phase 1 — schema permissiveness + steer default`. Body links the design doc.
- [ ] Verify post-merge with one C-1-style dogfood run: coordinator records `event_type: "note"`, steers team without setting `include_blackboard`, and the worker sees blackboard context in the steered message.

---

## Phase 2 — Defaults resolution and batch

**Single PR.** Builds on Phase 1; cuts per-call cost dramatically.

### Issue 2.1: `submit_task` defaults resolution from `.cuekit.yaml`

**Purpose:** AI can submit with `{ objective, team_id, position }` and let cuekit fill in `agent_kind`, `model`, `cwd`, `timeout_ms`, `priority` from `.cuekit.yaml`.

**Files:**
- Modify: `packages/mcp/src/commands/submit-task.ts`
- Modify: `packages/mcp/src/commands/submit-team-tasks.ts` (share helper)
- Modify: `packages/project-config/src/defaults.ts` (expose precedence helper if not already)
- Test: `packages/mcp/__tests__/commands.test.ts`

**Acceptance:**
- `submit_task({ objective: "..." })` succeeds when `.cuekit.yaml` defines `submit.agent` and `submit.cwd` (or when cwd is inferable from session).
- Response includes `defaults_applied: { agent_kind: "from_config", cwd: "from_session", ... }`.
- Explicit fields always override defaults.
- Existing tests that pass explicit fields keep passing.

**Steps:**
- [ ] **Step 1:** Add `defaults_applied` field to the output schema (optional record).
- [ ] **Step 2:** Build a `resolveSubmitDefaults({ explicit, profile, projectConfig })` helper returning `{ resolved, defaults_applied }`.
- [ ] **Step 3:** Update `runSubmitTask` to call the resolver before validating downstream constraints.
- [ ] **Step 4:** Update `runSubmitTeamTasks` to use the same resolver per task item.
- [ ] **Step 5:** Tests covering each defaults source: config, profile, explicit-wins.

### Issue 2.2: `submit_tasks` (plural) grouped tool

**Purpose:** Race-free parallel spawn in a single call.

**Files:**
- Create: `packages/mcp/src/commands/submit-tasks.ts`
- Modify: `packages/mcp/src/operations.ts` (register `submit_tasks` grouped tool)
- Modify: `packages/mcp/src/index.ts` (export if needed)
- Test: `packages/mcp/__tests__/commands.test.ts`

**Acceptance:**
- `submit_tasks({ tasks: [{...}, {...}] })` returns an array of per-item results.
- Each item resolves defaults independently (per Issue 2.1).
- Partial success: if item 2 fails validation, item 1 is still spawned and the response has `{ ok: true, results: [{ok:true}, {ok:false, error}] }`.
- Team-less submission works (`team_id` optional per-item).
- When `team_id` is given at the top level, it applies to all items.

**Steps:**
- [ ] **Step 1:** Define `SubmitTasksInputSchema` with `tasks: z.array(SingleSubmitItem).min(1)`.
- [ ] **Step 2:** Define output schema with per-item result objects.
- [ ] **Step 3:** Implement `runSubmitTasks` looping `runSubmitTask` with shared defaults.
- [ ] **Step 4:** Tests: all-success, mixed success/fail, team-less, with team_id.

### Issue 2.3: Strategy hint on `submit_task` response

**Purpose:** When the objective text matches a project strategy's keywords, surface a `strategy_hint` advising the coordinator to consider `start_team_strategy` instead.

**Files:**
- Modify: `packages/mcp/src/commands/submit-task.ts`
- Modify: `packages/mcp/src/team-strategy.ts` (extract a `matchStrategiesForObjective` helper)
- Test: `packages/mcp/__tests__/commands.test.ts`
- Test: `packages/mcp/__tests__/team-strategy.test.ts`

**Acceptance:**
- `submit_task({ objective: "Implement feature X" })` against a project with a `feature` strategy returns `strategy_hint: { strategy: "feature", rationale: "..." }`.
- No hint emitted when objective doesn't match any strategy.
- Matching is keyword-based (strategy `description` + `intent` tokenized; objective contains any token).
- Hint never blocks submission.

**Steps:**
- [ ] **Step 1:** Add the matching helper in `team-strategy.ts` with tests for hit/miss cases.
- [ ] **Step 2:** Call it from `runSubmitTask` after the task is accepted; include in response.
- [ ] **Step 3:** Tests: objective matches, doesn't match, multiple strategies with overlapping keywords (pick best by token-count).

### Phase 2 wrap

- [ ] Bundle, typecheck, test, check.
- [ ] Open PR titled `feat(mcp): Phase 2 — defaults resolution, submit_tasks, strategy hint`.
- [ ] Post-merge verification: a small dogfood team where the coordinator uses `submit_tasks` with minimal field counts.

---

## Phase 3 — Safety nets and observability

**Single PR.** Adds the bits operators need to feel safe letting AI run aggressive.

### Issue 3.1: Idempotency keys

**Purpose:** `submit_task` / `submit_tasks` accept `idempotency_key`; duplicates within the configured window return the original `task_id` with `deduplicated: true`.

**Files:**
- Modify: `packages/store/src/task-store.ts` (new `idempotency_key` column + index)
- Create: `packages/store/migrations/<next>-tasks-idempotency-key.sql`
- Modify: `packages/mcp/src/commands/submit-task.ts`
- Modify: `packages/mcp/src/commands/submit-tasks.ts`
- Modify: `packages/project-config/src/schema.ts` (`submit.idempotency_window_ms`)
- Modify: `packages/project-config/src/defaults.ts`
- Test: `packages/mcp/__tests__/commands.test.ts`
- Test: `packages/store/__tests__/`

**Acceptance:**
- Two `submit_task` calls with the same `(session_id, idempotency_key)` within the window return the same `task_id`; the second carries `deduplicated: true`.
- After the window expires, the same key spawns a new task.
- Omitting `idempotency_key` keeps current behaviour.
- Migration adds the column without breaking existing rows.

**Steps:**
- [ ] **Step 1:** Write the migration SQL (`alter table tasks add column idempotency_key text` + index).
- [ ] **Step 2:** Update `createTask` / row decoder to carry the field.
- [ ] **Step 3:** Add `findTaskByIdempotencyKey(db, session_id, key, window_ms)` to `task-store.ts`.
- [ ] **Step 4:** Update `runSubmitTask` to check the key first, return existing on hit.
- [ ] **Step 5:** `.cuekit.yaml` schema: `submit.idempotency_window_ms` (default 600000).
- [ ] **Step 6:** Tests including window expiry.

### Issue 3.2: Concurrency quotas

**Purpose:** `.cuekit.yaml` `submit.max_concurrent_tasks` and `teams.max_workers_per_team` reject over-spawn with a structured error.

**Files:**
- Modify: `packages/project-config/src/schema.ts`
- Modify: `packages/project-config/src/defaults.ts`
- Modify: `packages/mcp/src/commands/submit-task.ts`
- Modify: `packages/mcp/src/commands/submit-tasks.ts`
- Modify: `packages/mcp/src/commands/submit-team-tasks.ts`
- Modify: `packages/store/src/task-store.ts` (add `countRunningTasksBySession`, `countWorkersByTeam`)
- Test: `packages/mcp/__tests__/commands.test.ts`

**Acceptance:**
- When `submit.max_concurrent_tasks: 4` and 4 tasks are running in the session, a 5th `submit_task` returns `code: "quota_exceeded"` with `next_action_hint` listing running task ids.
- `teams.max_workers_per_team` similarly limits worker-positioned tasks within one team.
- Both null/unset = unlimited (current behaviour).
- Cancelled/terminal tasks don't count against the cap.

**Steps:**
- [ ] **Step 1:** Add schema keys and defaults.
- [ ] **Step 2:** Add store helpers for counting active rows.
- [ ] **Step 3:** Add quota check before `applyTeamWaitDefaults` / submit dispatch.
- [ ] **Step 4:** Tests for under, at, over the cap.

### Issue 3.3: `must_inspect` flag on wait/snapshot responses

**Purpose:** Schema-level signal that `attention_items` is non-empty and must be inspected before next action.

**Files:**
- Modify: `packages/mcp/src/commands/wait-tasks.ts`
- Modify: `packages/mcp/src/commands/wait-team.ts`
- Modify: `packages/mcp/src/commands/get-task-snapshot.ts`
- Modify: `packages/mcp/src/commands/get-team-snapshot.ts`
- Modify: `packages/mcp/src/team-attention.ts` (helper)
- Test: `packages/mcp/__tests__/commands.test.ts`

**Acceptance:**
- Responses include `must_inspect: true` when `attention_items` has at least one entry; otherwise `must_inspect: false` (or omitted).
- Tool descriptions for `wait` and `get_*_snapshot` reference the flag.

**Steps:**
- [ ] **Step 1:** Add the field to the relevant output schemas.
- [ ] **Step 2:** Set the flag in resolver code based on `attention_items.length`.
- [ ] **Step 3:** Update tool description text.
- [ ] **Step 4:** Tests for empty vs non-empty attention_items.

### Issue 3.4: `team_metrics` on snapshot

**Purpose:** Self-budgeting fields for coordinators.

**Files:**
- Modify: `packages/mcp/src/commands/get-team-snapshot.ts`
- Modify: `packages/mcp/src/team-status.ts` or similar (extract aggregation helper)
- Test: `packages/mcp/__tests__/commands.test.ts`

**Acceptance:**
- `get_team_snapshot` response includes `team_metrics: { spawned_task_count, terminal_task_count, running_task_count, cumulative_runtime_ms, elapsed_since_team_start_ms }`.
- `cumulative_runtime_ms` sums per-worker runtimes (sum, not wall-clock — design decision §Open Q 5).
- `elapsed_since_team_start_ms` is wall-clock since `task_teams.created_at`.

**Steps:**
- [ ] **Step 1:** Build `computeTeamMetrics(db, team_id)` aggregator.
- [ ] **Step 2:** Add to snapshot response.
- [ ] **Step 3:** Tests covering empty team, all-terminal team, mixed team.

### Phase 3 wrap

- [ ] Bundle, typecheck, test, check.
- [ ] Open PR titled `feat(mcp): Phase 3 — idempotency, quotas, observability`.
- [ ] Post-merge verification: enable quotas in `.cuekit.yaml`, run a coordinator that intentionally over-spawns, confirm graceful rejection.

---

## Phase 4 — Structured coordinator outcomes & prompt shrink

**Single PR.** Depends on Phase 1 (relaxed event_type), Phase 3 (must_inspect, team_metrics).

### Issue 4.1: Structured `outcome` payload on terminal events

**Purpose:** Reduce LLM-summarisation error rate in `get_team_result` and the coordinator's final report.

**Files:**
- Modify: `packages/core/src/` (add `OutcomeSchema`)
- Modify: `packages/mcp/src/commands/report-task-event.ts`
- Modify: `packages/store/src/task-store.ts` (store `outcome` in event payload)
- Modify: `packages/mcp/src/commands/get-team-result.ts` (aggregate `outcome` when present)
- Modify: `packages/mcp/src/team-run-summary.ts`
- Test: `packages/mcp/__tests__/commands.test.ts`

**Acceptance:**
- `report_task_event({ event_type: "completed", outcome: { status: "success", findings: [...], follow_ups: [...] } })` persists the structured payload.
- `get_team_result` returns an `outcome_summary` aggregated from worker `outcome` fields when present.
- Existing free-text-only completed events still work (outcome is optional).

**Steps:**
- [ ] **Step 1:** Define `OutcomeSchema` in `@cuekit/core`.
- [ ] **Step 2:** Update `AppendTaskEventInput` to accept optional outcome.
- [ ] **Step 3:** Store outcome inside the event payload_json blob.
- [ ] **Step 4:** Update `buildTeamRunSummary` to surface `outcomes_by_position`.
- [ ] **Step 5:** Tests: structured outcome present, absent, mixed.

### Issue 4.2: Shrink `renderTeamStrategyPrompt`

**Purpose:** Move enforce-able rules out of the prompt; keep the prompt focused on judgement.

**Files:**
- Modify: `packages/mcp/src/team-strategy.ts`
- Modify: `packages/mcp/__tests__/team-strategy.test.ts`

**Acceptance:**
- The line about `include_blackboard` is removed (default is now the rule, set in Phase 1).
- The line about `attention_items` is shortened to one sentence referencing `must_inspect`.
- The finisher post-completion guidance is shortened (the finisher's completed event now carries `coordinator_next_action: "finalize"` — see below).
- Final coordinator prompt is at least 30% shorter than pre-Phase-4 baseline (character count).
- Existing tests for the prompt are updated to reflect the new shorter content.

**Steps:**
- [ ] **Step 1:** Record current prompt character count as baseline (in test or comment).
- [ ] **Step 2:** Add `coordinator_next_action` field to finisher's completed event in the prompt-rendering flow (or wherever the finisher hint is constructed).
- [ ] **Step 3:** Rewrite the prompt section by section.
- [ ] **Step 4:** Update test assertions: remove specific phrases now lived in API; assert the prompt still contains the judgement-level guidance.
- [ ] **Step 5:** Add a length-budget regression assertion.

### Phase 4 wrap

- [ ] Bundle, typecheck, test, check.
- [ ] Open PR titled `feat(mcp): Phase 4 — structured outcomes + coordinator prompt shrink`.
- [ ] Post-merge verification: run a strategy team and check that the rendered prompt is shorter and that the final report uses the structured `outcome` aggregation.

---

## Phase 5 — Lifecycle and verification (deeper work)

**Two PRs.** The first is auto-cleanup + decision limit; the second is the echo-verification research spike if pursued.

### Issue 5.1: Time-based auto-cleanup of terminal tasks

**Purpose:** Operator-configurable retention so terminal tasks don't accumulate.

**Files:**
- Modify: `packages/project-config/src/schema.ts` (`teams.cleanup_terminal_after_hours`)
- Modify: `packages/project-config/src/defaults.ts`
- Modify: `packages/mcp/src/commands/cleanup-tasks.ts` (or new helper)
- Modify: `packages/store/src/task-store.ts` (helper: `listTerminalTasksOlderThan`)
- Modify: `packages/mcp/src/cleanup-hints.ts` (suggest cleanup when threshold met)
- Test: `packages/mcp/__tests__/commands.test.ts`

**Acceptance:**
- `.cuekit.yaml teams.cleanup_terminal_after_hours: 168` causes `cleanup` to remove terminal task event records older than 168 h.
- Long-lived parent-session tasks (`metadata.run_kind: "parent_session"`) are skipped.
- Task row tombstone is kept for one further window so `get_task_status` returns a useful "cleaned" status.
- Default value `null` (or unset) keeps existing keep-forever behaviour.

**Steps:**
- [ ] **Step 1:** Schema + default values.
- [ ] **Step 2:** Store helpers for selecting + deleting old terminal events.
- [ ] **Step 3:** Cleanup command wires through the new config.
- [ ] **Step 4:** Tests covering threshold cross, parent-session skip, tombstone.

### Issue 5.2: Coordinator decision limit

**Purpose:** Hard cap on a coordinator's state-changing MCP calls to prevent runaway loops.

**Files:**
- Create: `packages/mcp/src/coordinator-decision-counter.ts`
- Modify: `packages/mcp/src/commands/submit-task.ts`, `submit-tasks.ts`, `submit-team-tasks.ts`, `steer-task.ts`, `steer-team.ts`, `cancel-task.ts`, `delete-task.ts`, `delete-team.ts`
- Modify: `packages/project-config/src/schema.ts` (`coordinator.max_decisions`)
- Test: `packages/mcp/__tests__/commands.test.ts`

**Acceptance:**
- The counter increments on each state-changing call where the *caller* (`session_id`) is the coordinator of a team.
- Read-only calls (`list`, `get_*`, `wait`) do NOT increment.
- At the cap, the next state-changing call returns `code: "decision_limit_reached"` with `next_action_hint: "report help_requested to parent or finalize"`.
- `null` / unset = unlimited (current behaviour).

**Steps:**
- [ ] **Step 1:** Define `CoordinatorDecisionCounter` interface + in-memory implementation keyed by `session_id`.
- [ ] **Step 2:** Wire the counter through `CommandContext` so each command can call `counter.increment(session_id)`.
- [ ] **Step 3:** Insert increments in the listed commands; document which commands are counted in a single source-of-truth comment.
- [ ] **Step 4:** Schema + default.
- [ ] **Step 5:** Tests covering under-cap, at-cap, beyond-cap, read-only-not-counted.

### Issue 5.3 *(research, may defer)*: Echo verification for `steer`

**Purpose:** Pane-capture diff after steer to surface `delivery_uncertain: true`.

**Files:**
- Modify: `packages/mcp/src/commands/steer-task.ts`
- Modify: `packages/adapters/src/pane-adapter.ts` (capture-after-steer helper if not present)
- Test: requires adapter integration; may need real-pane integration test gated on `hasTmux()`.

**Acceptance:**
- `steer({ ..., verify_echo: true })` captures pane content before and after steer; if no diff within `echo_wait_ms` (default 250 ms), response includes `delivery_uncertain: true`.
- Default behaviour (no `verify_echo`) unchanged.
- Works across `claude-code`, `pi`, `opencode`, `gemini`, `jcode` adapters — or documents which adapters are unsupported.

**Risk:** This needs a research spike. Some adapters produce delayed output (claude-code thinking time) where a 250 ms diff window will frequently false-positive. Recommend running a one-day spike before committing to an implementation; an inconclusive spike justifies parking this issue.

**Steps (if pursued):**
- [ ] **Step 1:** Spike: measure pane-output cadence under steer for each adapter. Document findings.
- [ ] **Step 2:** Implement only for adapters where the cadence is reliably faster than `echo_wait_ms`.
- [ ] **Step 3:** Add an opt-in test gated on real-pane availability.

### Phase 5 wrap

- [ ] PR titled `feat(mcp): Phase 5a — auto-cleanup + decision limit`.
- [ ] Open question gate: should Phase 5b (echo verification) be pursued now or deferred? Decide based on Phase 1–4 dogfooding results.

---

## Sequencing notes

- **Phase 1 can ship in isolation** with low risk. Run a C-1-style dogfood verification post-merge.
- **Phase 2 depends on Phase 1** for tool description rewrites that reference `submit_tasks`.
- **Phase 3 depends on Phase 2** (for `submit_tasks` quota application).
- **Phase 4 depends on Phase 1** (event_type relaxation) and **Phase 3** (must_inspect, team_metrics referenced in shrunk prompt).
- **Phase 5a is independent** but should ship after Phase 4 so the shrunk prompt can also reference decision-limit hints.
- **Phase 5b (echo verification)** is research-gated; do not block other phases on it.

A typical rollout would land Phase 1 in ~1 day, Phase 2 in ~2 days, Phase 3 in ~3 days, Phase 4 in ~2 days, Phase 5a in ~2 days. Phase 5b TBD.

---

## Verification per phase

Each phase PR must include:

- [ ] Unit tests for every new/changed schema field and resolver path.
- [ ] At least one integration test that exercises the change end-to-end through `runCuekitMcpBin` if the change is user-observable.
- [ ] `bun run typecheck` clean across all 8 workspace packages.
- [ ] `bun test` full suite green (no new failures).
- [ ] biome check clean on changed files.
- [ ] Updated tool description text verified via a smoke assertion.
- [ ] CHANGELOG.md entry under the active version section.
- [ ] Bundle regenerated (`bun run bundle` + `cp bin/cuekit.js packages/cli/bin/cuekit.js`).
- [ ] Site docs in `site/api/mcp-tools.md` and `site/guides/project-config.md` updated where user-visible.

---

## Risk register

| Risk | Mitigation |
|---|---|
| Behaviour change in Phase 1.3 (`include_blackboard` default flip) surprises an existing caller. | Document in CHANGELOG and PR body; explicit opt-out remains; team-strategy prompt updated. |
| Phase 3 quota rejection breaks a coordinator that doesn't expect quotas. | Default unset = unlimited; rollout requires explicit `.cuekit.yaml` configuration. |
| Phase 4 prompt shrink causes coordinator regressions on cheaper LLMs. | Length-budget regression test; keep judgement-level guidance intact; manual dogfood verification post-merge. |
| Phase 5b echo verification produces frequent false positives. | Research spike before commit; ship only if reliable per-adapter; opt-in flag, never default. |
| Migration (Phase 3 idempotency, Phase 4 outcome) introduces schema drift. | Standard cuekit migration test pattern; verify roundtrip on an existing state.db copy. |

---

## Out of scope for this plan

- Aider / Codex CLI adapter additions
- TUI render improvements to display new response fields
- Release/version bumps (covered by ADR 005)
- VS Code / Cursor extension
- AI cookbook documentation (`docs/patterns/`) — separate plan when this rollout completes

Those are valid follow-ups but live in their own plans.
