# cuekit AI Ergonomics & Coordinator Quality Design

## Status

Proposed. 2026-05-21.

## Problem

cuekit is intentionally AI-first: the CLI and grouped MCP surface are designed to be driven by a parent AI agent, while humans monitor through the TUI. The current API surface works, but several friction points discourage AI agents from reaching for cuekit *frequently* and *reliably*. We observed concrete evidence of these during the C-1 dogfood verification (PR #558) and during day-to-day operation:

### Friction observed in practice

| Symptom | Where it appeared | Cost |
|---|---|---|
| Coordinator wanted to record an `event_type: "note"` blackboard entry but the enum rejected it; fell back to `finding` (semantically wrong). | C-1 dogfood team — coordinator self-reported the gap. | Pollutes blackboard taxonomy; coordinator memory drifts from intent. |
| `submit_task` requires `agent_kind`, `model`, `cwd` every call even when `.cuekit.yaml` defaults exist. | Repeatedly in this session. | ~60% of fields are boilerplate; AI either skips important fields or wastes context tokens. |
| `cuekit team start --coordinator '{"agent_kind":"…","model":"…"}'` requires a JSON-stringified object, and `agent_kind` vs `agent` is easy to get wrong. | C-1 verification — first attempt failed schema validation. | High-friction override path that humans and AIs both stumble on. |
| `include_blackboard: true` on `steer_team` is *prompt-nudged* (via the strategy coordinator prompt), so its use depends on the LLM reading and following a long instruction block. | Added in #558; works in our test, but is structurally probabilistic. | Cheaper / smaller LLMs may skip it, defeating the feature. |
| Coordinators issue several `submit_task` calls sequentially when they want to spawn parallel workers, because there is no batch primitive for non-team work. | Throughout. | Race-condition-flavoured "did I forget the 3rd one?" patterns. |
| `attention_items` ride in the wait/snapshot response but coordinators can plough past them. | Latent risk; not directly exercised in C-1 but documented in `cuekit-team-attention-items-design.md`. | Coordinator can over-spawn or under-react. |
| `report` `event_type` enum lacks neutral process markers (`note`, `checkpoint`, `progress`). | Coordinator workaround surfaced this. | Forces semantic distortion. |
| No idempotency on `submit_task`. AI retries can double-submit identical work. | Latent. | Wasted spawns; downstream confusion. |
| No concurrency cap on parallel spawn. | Latent. | Operator nervousness about "letting AI run wild" suppresses aggressive cuekit use even where it would help. |
| `steer` returns "delivered to pane stdin" but does not confirm the receiving agent observed the change. | Latent; partially surfaced in C-1 (worker terminated before steer landed). | Coordinator cannot self-correct on stale steers. |
| `renderTeamStrategyPrompt` is 4–5 paragraphs of imperative guidance. | Visible in `packages/mcp/src/team-strategy.ts`. | LLM prompt-following degrades with length; coordinator quality varies by model size. |

### Why this matters

The desired usage pattern is "AI drives, human monitors". For that to feel natural, the AI side of cuekit must be:

- **cheap to call** — a coordinator submitting 10 workers should not have to write 10 verbose call objects;
- **forgiving of small mistakes** — a misspelled `event_type` should not abort progress;
- **safe to be aggressive with** — operators should not fear an AI overspawning;
- **reliable without depending on prompt-following** — critical behaviors should be enforced by the API, not by hopes that the LLM read the strategy prompt carefully;
- **self-observable** — the coordinator should be able to ask cuekit "how much have I done?" and "did this steer take effect?" without parsing transcripts.

Today the surface satisfies some of these but not all, and the gap is concentrated in places that disproportionately affect coordinator behaviour.

## Design Goals

1. **Lower per-call cognitive cost.** Cut required fields and accept liberal inputs where intent is unambiguous.
2. **Migrate critical behaviors from prompt to API.** Defaults, attention surfacing, and blackboard attachment should not depend on prompt-reading.
3. **Provide safety nets.** Idempotency, concurrency caps, and automatic cleanup so operators trust AI-driven use.
4. **Improve self-observability for coordinators.** Cumulative metrics, strategy hints, and steer-effect confirmation enable coordinators to self-correct.
5. **Shrink coordinator prompts.** Pull out anything that can be API-enforced; let the prompt focus on judgement, not bookkeeping.
6. **Stay inside the existing scope.** No auto-scheduling, no autonomous loop, no workflow engine. The parent agent still decides what to do (ADR 001).

## Non-Goals

- **No autonomous loop.** cuekit will not auto-spawn workers from strategy skeletons, auto-finalize teams, or auto-retry failed tasks. These remain coordinator decisions.
- **No workflow engine.** Strategies stay as prompt context, not as executed graphs.
- **No hosted service or telemetry.** All state remains local.
- **No breaking the grouped MCP surface.** Existing tool names and grouped dispatch stay; new behaviour is additive.
- **No deletion of flat aliases.** `steer_task`, `steer_team`, `report_task_event` remain as compatibility aliases; descriptions guide AI toward grouped tools.

## Design Overview

The proposed changes span seven areas:

```
┌── Area 1: Schema permissiveness ────────────┐  per-call cost
├── Area 2: Batch & idempotency ──────────────┤
├── Area 3: Steer reliability ────────────────┤  coordinator quality
├── Area 4: Safety nets (quotas, cleanup) ────┤  operator trust
├── Area 5: Self-observability ───────────────┤
├── Area 6: Prompt → API migration ───────────┤  coordinator quality
└── Area 7: Coordinator lifecycle safety ─────┘
```

Each area is independent enough to ship on its own, but they compound: defaults (Area 1.2) make batch submission (Area 2.1) more useful; quotas (Area 4.1) let operators relax about idempotency-key duplication (Area 2.2); API-enforced `include_blackboard` (Area 3.1) lets us cut prompt length (Area 6.1).

## Area 1 — Schema Permissiveness

### 1.1 Relax `report` event_type

**Current.** `report_task_event` and `report_team_event` accept a closed enum of event types (`started`, `progress`, `finding`, `decision`, `completed`, `failed`, `blocked`, `handoff`, etc., per `packages/core`).

**Proposed.** Keep the curated set as *recommended* labels, but accept any non-empty string with `event_type: z.string().min(1)`. Validation continues to reject obvious garbage (empty strings, control characters). The TUI and `list({kind:"events"})` continue to group/filter by event_type, treating unknown types as a passthrough bucket.

**Why.** The C-1 coordinator wanted `note` and was forced into `finding`. The cost of the enum is higher than the benefit; categorisation should be advisory, not enforced.

**Curated recommended set** (after change):

```
started, progress, note, checkpoint, finding, decision,
handoff, blocked, help_requested, completed, failed, cancelled
```

`note` and `checkpoint` are the new neutral process markers.

### 1.2 Smart default resolution from `.cuekit.yaml`

**Current.** `submit_task` requires `agent_kind` (validation error otherwise). `model`, `cwd`, `timeout_ms`, `priority`, `role` are individually optional but the AI typically supplies them defensively. Project-level `.cuekit.yaml` `submit.*` defaults exist but the MCP path doesn't aggressively use them.

**Proposed.** The MCP server resolves defaults *before* validation:

```
agent_kind  = explicit ?? resolved_role.agent_kind ?? .cuekit.yaml submit.agent ?? error
model       = explicit ?? resolved_role.model     ?? .cuekit.yaml submit.model
cwd         = explicit ?? .cuekit.yaml config_root
timeout_ms  = explicit ?? .cuekit.yaml submit.timeout_ms
priority    = explicit ?? .cuekit.yaml submit.priority ?? "normal"
role        = explicit ?? .cuekit.yaml submit.role
```

When defaults are used, the response surfaces a `defaults_applied: { agent_kind: "from_config", model: "from_role", ... }` field so the AI sees which values came from where (helps debugging).

**Tool description update.** `submit_task` description gains: "Most fields are optional when `.cuekit.yaml` defines them; supply only what overrides the project default."

**Why.** Most fields per call are boilerplate. After this change a typical coordinator submit becomes:

```jsonc
{ "objective": "...", "team_id": "tm_xxx", "position": "worker" }
```

instead of the current six-field call.

### 1.3 Flat coordinator override fields on `start_team_strategy`

**Current.** Coordinator overrides must be a JSON-stringified object with `agent_kind` / `model` / `role` / `timeout_ms` / `adapter_options` keys. CLI users pass `--coordinator '{"agent_kind":"claude-code","model":"sonnet"}'`. The `agent` vs `agent_kind` mismatch costs operator time.

**Proposed.** Accept flat fields alongside the existing object form:

```jsonc
// flat (new, recommended)
{ "strategy": "feature", "objective": "...",
  "coordinator_agent_kind": "claude-code",
  "coordinator_model": "sonnet" }

// object (existing, kept)
{ "strategy": "feature", "objective": "...",
  "coordinator": { "agent_kind": "claude-code", "model": "sonnet" } }
```

If both are provided, the object form wins (explicit beats inferred). CLI gains matching `--coordinator-agent-kind` / `--coordinator-model` flags.

**Why.** Flat fields are AI- and CLI-friendly. JSON-string parameters reliably trip up smaller models.

## Area 2 — Batch & Idempotency

### 2.1 `submit_tasks` (new grouped tool)

**Current.** `submit_task` spawns one task at a time. `submit_team_tasks` exists but requires a `team_id`.

**Proposed.** Add `submit_tasks` (grouped, plural) that takes an array of task specs. `team_id` is optional. Each item carries its own `idempotency_key` (see 2.2). The response is an array of per-item results, supporting partial success.

```jsonc
// input
{
  "tasks": [
    { "objective": "review packages/cli", "role": "reviewer" },
    { "objective": "review packages/mcp", "role": "reviewer" }
  ]
}

// output
{
  "accepted": true,
  "results": [
    { "ok": true, "task_id": "t_aaa", "defaults_applied": {...} },
    { "ok": false, "error": { "code": "...", "message": "..." } }
  ]
}
```

**Why.** Race-free parallel spawn. Coordinators that want N independent jobs make one MCP call.

### 2.2 Idempotency keys

**Current.** Retrying `submit_task` with identical input creates a fresh task. AI retries on flaky tool calls are unsafe.

**Proposed.** `submit_task` and `submit_tasks` accept optional `idempotency_key: string`. cuekit dedups within the parent session (`session_id`) for a configurable window (`.cuekit.yaml submit.idempotency_window_ms`, default 600_000 = 10 min). When a duplicate arrives, the existing `task_id` is returned with `deduplicated: true`.

Implementation note: the key is stored on `tasks` with an index `(session_id, idempotency_key)`.

**Why.** Lets AI agents retry without fear of double-spawn.

## Area 3 — Steer Reliability

### 3.1 `include_blackboard: true` becomes the default for team-level steer

**Current.** `steer({kind:"team"|"team_position"|"team_tasks"})` defaults `include_blackboard` to `false`. The coordinator prompt nudges it on via #558.

**Proposed.** The default flips to `true` for the three team-shaped kinds (`team`, `team_position`, `team_tasks`). `steer({kind:"task"})` keeps `false` as default because per-task steers usually have specific local context.

Opt-out is explicit: `include_blackboard: false`.

**Why.** Today this is prompt-load-bearing. Moving it to an API default removes the dependency on the LLM reading the strategy block.

**Backward compatibility.** Callers that don't supply `include_blackboard` get blackboard context — strictly additive content in the steered message. No call should break; the only visible change is more context arriving at workers. The prompt nudge added in #558 is updated to document the default rather than encourage it.

### 3.2 Steer-effect echo verification (research)

**Current.** A successful `steer_task` means the adapter wrote to the pane's stdin. It does not mean the agent has read or acted on the message.

**Proposed (research; not blocking).** After a successful steer, optionally capture the pane for ~250ms and compare against the pre-steer capture. If the pane content has not changed within a configurable `echo_wait_ms`, surface `delivery_uncertain: true` in the steer response. The default behaviour is unchanged; coordinators must opt in with `verify_echo: true`.

Open question: how to detect "agent processed steer" reliably across adapters with very different output behaviours. Echo verification needs a research spike before commit.

**Why.** Coordinators that miss a steer waste a wait cycle. Even a coarse "stdin written but no observable output yet" hint is useful.

## Area 4 — Safety Nets

### 4.1 Concurrency quotas

**Current.** Unlimited parallel spawn from any session. An overcautious operator runs cuekit conservatively because of this.

**Proposed.** `.cuekit.yaml` accepts:

```yaml
submit:
  max_concurrent_tasks: 8            # per session; null/omit = unlimited

teams:
  max_workers_per_team: 4            # excludes coordinator/finisher
```

When a submit would exceed the cap, cuekit rejects with `code: "quota_exceeded"` and a structured next-action hint listing currently-running task ids. The coordinator can then `wait`, cancel, or proceed with fewer workers.

**Why.** Operator confidence to let AI go aggressive. Caps are configurable, not enforced cuekit-side beyond what the project chooses.

### 4.2 Time-based auto-cleanup of terminal tasks

**Current.** Terminal tasks accumulate forever unless `cuekit cleanup` is invoked. `teams.cleanup` is reserved but inactive.

**Proposed.** `.cuekit.yaml`:

```yaml
teams:
  cleanup: keep-team
  cleanup_terminal_after_hours: 168  # default 0 = keep forever; non-zero = auto-cleanup
```

Cleanup deletes `task_events` records and pane artifacts for terminal tasks older than the threshold. Task rows themselves are kept for one further window (so `get_task_status` returns a tombstone, not "not found"). Long-lived parent-session tasks (`metadata.run_kind: "parent_session"`) are never auto-cleaned.

**Why.** Coordinators don't want stale tasks in their snapshot view; operators don't want to schedule cleanup themselves.

## Area 5 — Self-Observability for Coordinators

### 5.1 Cumulative metrics in snapshots

**Current.** `get_team_snapshot` returns recent events, members, attention_items, transcript tails. It does not summarise *how much team activity has happened so far*.

**Proposed.** Add to `get_team_snapshot` response:

```jsonc
{
  ...,
  "team_metrics": {
    "spawned_task_count": 7,
    "terminal_task_count": 4,
    "running_task_count": 3,
    "cumulative_runtime_ms": 245_000,
    "elapsed_since_team_start_ms": 380_000
  }
}
```

Coordinators can self-budget: "I've used 4 of my 8-task quota; 3 still running."

### 5.2 Strategy hint on `submit_task`

**Current.** A coordinator wanting strategy guidance must explicitly call `list({kind:"strategies"})` and then `start_team_strategy`. Ad-hoc submission stays ad-hoc.

**Proposed.** `submit_task` response includes `strategy_hint` when the objective text contains keywords matching a project strategy's `description` / `intent`:

```jsonc
{
  "accepted": true,
  "task_id": "t_xyz",
  "strategy_hint": {
    "strategy": "feature",
    "rationale": "objective mentions 'implement feature' and matches the 'feature' strategy's intent"
  }
}
```

The hint is advisory; the coordinator decides whether to escalate to `start_team_strategy` for subsequent related work.

**Why.** Nudges coordinators from ad-hoc spawn toward pattern-driven team strategies without forcing it.

### 5.3 `attention_items` prominence

**Current.** `attention_items` ride in wait/snapshot responses but coordinators can miss them.

**Proposed.**

- When `attention_items` is non-empty, add a top-level `must_inspect: true` flag in the same response.
- Tool description for `wait` and `get_team_snapshot` adds: "If the response contains `must_inspect: true`, inspect `attention_items` *before* any subsequent action."

**Why.** Schema-level signal is more visible to AI than a buried array field.

## Area 6 — Prompt → API Migration

### 6.1 Shrink `renderTeamStrategyPrompt`

**Current.** ~10 paragraph-equivalent sections (recipe, position assignment, attention items, final-report gating, finisher behaviour, blackboard nudge, etc.).

**Proposed.** Move the following from prompt to API:

| Prompt content today | Moved to API |
|---|---|
| "When steering team tasks, prefer include_blackboard: true" | API default (Area 3.1) — line removed from prompt |
| "When team status or result includes attention_items, inspect them..." | `must_inspect` flag (Area 5.3) — line shortened to "Respect `must_inspect: true`" |
| "After a `position: finisher` task completes ... emit your final completed report" | Finisher's `completed` event gains `coordinator_next_action: "finalize"` field; prompt line shortened |

After these moves the prompt drops by an estimated 30–40%. The remaining prompt focuses on *judgement-level* guidance (when to add workers, when to escalate to parent, what to write in the final report).

### 6.2 Tool description rewrite

**Current.** Schema `.describe()` fields document *what* a field is.

**Proposed.** Rewrite every grouped MCP tool's top-level description to lead with *when to use it*:

- `submit_task` — "Spawn one child agent. Use when delegating a bounded, well-defined sub-task. For multiple parallel sub-tasks, prefer `submit_tasks`. For mission-shaped work with multiple roles, prefer `start_team_strategy`."
- `steer` — "Inject a new instruction into a running task or team. Use when the receiver has stalled, misunderstood, or needs new context. Always inspect `get_task_snapshot` or `get_team_snapshot` first."
- `wait` — "Bounded poll for terminal status. Use short timeouts (≤ 30s) and re-poll rather than one long wait. Set `follow_new_tasks: true` for coordinator-led teams."

**Why.** AI uses tool descriptions for in-context learning; "when to use" descriptions improve tool selection accuracy.

## Area 7 — Coordinator Lifecycle Safety

### 7.1 Coordinator decision limit

**Current.** Coordinators run with `timeout_ms: null` to survive long workers. They can loop indefinitely if they fail to terminate.

**Proposed.** `.cuekit.yaml`:

```yaml
coordinator:
  max_decisions: 50   # soft cap; null = unlimited
```

cuekit counts each `submit_task` / `submit_tasks` / `submit_team_tasks` / `steer` / `wait` call the coordinator makes. At the cap, the next call returns `code: "decision_limit_reached"` with the suggestion "escalate to parent or finalize."

The coordinator can voluntarily exit, or the parent (human via TUI, or higher-level agent) can decide.

**Why.** Prevents runaway coordinators without disabling long-lived ones.

### 7.2 Structured worker outcomes

**Current.** Worker `completed` events carry free-text `message`. The coordinator parses these with its own LLM reasoning to write the final report.

**Proposed.** `report` (`report_task_event`) accepts an optional structured payload on terminal events:

```jsonc
{
  "task_id": "t_worker_1",
  "event_type": "completed",
  "message": "...",
  "outcome": {
    "status": "success",                   // success | partial | blocked
    "findings": ["found bug X", "applied fix Y"],
    "follow_ups": ["add regression test"]
  }
}
```

`get_team_result` aggregates `outcome` fields when present, so the coordinator's final report no longer requires LLM-summarisation of free-text.

**Why.** Reduces coordinator workload and error rate when synthesising team results.

## Backward Compatibility

| Area | Compat impact |
|---|---|
| 1.1 event_type relaxation | Strict-supplement; existing callers still work. |
| 1.2 defaults resolution | Strictly additive; explicit fields still win. |
| 1.3 flat coordinator fields | Additive; existing JSON object form continues to work. |
| 2.1 submit_tasks | New tool; existing `submit_task` unchanged. |
| 2.2 idempotency_key | Optional; absence means current behaviour. |
| 3.1 include_blackboard default flip | **Behaviour change** — receivers see additional context. Mitigated: opt-out remains, prompt nudge updated to describe default. |
| 3.2 echo verification | Opt-in via flag; default unchanged. |
| 4.1 quotas | Opt-in via `.cuekit.yaml`; unset = unlimited (current). |
| 4.2 auto-cleanup | Opt-in via `.cuekit.yaml`; default = keep forever (current). |
| 5.1 team_metrics | Additive response field. |
| 5.2 strategy_hint | Additive response field; advisory. |
| 5.3 must_inspect | Additive flag. |
| 6.1 prompt shrink | Behaviour change for coordinator prompt content. Existing tests in `team-strategy.test.ts` need updates. |
| 6.2 tool descriptions | No schema change; only `.describe()` text. |
| 7.1 decision limit | Opt-in via `.cuekit.yaml`; default = unlimited. |
| 7.2 structured outcomes | Optional payload on existing event shape. |

The single behaviour-change item is 3.1 (`include_blackboard` default). All others are opt-in or additive.

## Open Questions

1. **Strategy hint matching algorithm.** Keyword-based (cheap, predictable) vs LLM-based (more accurate, costs a small inference). Start keyword-based; revisit.
2. **Idempotency dedup window scope.** Session-scoped (proposed) vs project-scoped vs cwd-scoped. Session-scoped matches today's `session_id` ownership semantics.
3. **Echo verification implementation.** How to detect "agent processed steer" across `claude-code`, `opencode`, `pi`, `jcode`, `gemini` adapters whose pane output cadence differs widely. Defer to a research spike.
4. **Quota over-spawn behaviour.** Hard reject (proposed) vs queue (more graceful but introduces ordering surprises). Hard reject preserves the "no scheduler" property.
5. **`team_metrics.cumulative_runtime_ms` definition.** Sum of worker runtimes vs wall-clock elapsed since first member. Proposed: sum (matches "how much work was done"), not elapsed.
6. **Auto-cleanup vs parent-session long-lived tasks.** Documented exclusion: `metadata.run_kind: "parent_session"` is never auto-cleaned. Edge case: terminal parent-sessions should be cleanable; revisit.
7. **Decision-limit counting.** What counts as a "decision"? Proposed: any state-changing MCP call (submit, steer, cancel, delete). Read-only calls (`list`, `get_*`, `wait`) do not count.

## Phased Implementation Sketch

Detailed implementation plan will live at `docs/plans/<date>-ai-ergonomics-rollout.md`. The phasing below is illustrative.

### Phase 1 — Quick wins (low-risk, prompt independence)

- 1.1 `event_type` relaxation
- 1.3 Flat `coordinator_*` fields
- 3.1 `include_blackboard` default flip
- 6.2 Tool description rewrites

### Phase 2 — Defaults and batch (call ergonomics)

- 1.2 Smart default resolution
- 2.1 `submit_tasks` batch tool
- 5.2 Strategy hint in `submit_task` response

### Phase 3 — Safety nets and observability

- 2.2 Idempotency keys
- 4.1 Concurrency quotas
- 5.1 `team_metrics`
- 5.3 `must_inspect` flag

### Phase 4 — Structured coordinator outcomes

- 7.2 Structured `outcome` on completed events
- 6.1 Prompt shrink (depends on 3.1, 5.3, 7.2 being live)

### Phase 5 — Lifecycle and verification (deeper work)

- 4.2 Auto-cleanup
- 7.1 Decision limit
- 3.2 Echo verification (research first)

## Success Criteria

| Criterion | How to measure |
|---|---|
| Coordinators can run reliably on cheaper LLMs (e.g. Haiku) | Run the C-1 style verification with a Haiku coordinator on `dogfood` strategy; observe correct `include_blackboard` usage and team finalization. |
| Per-call cost of `submit_task` halved | Compare median field count in `submit_task` payloads pre- vs post-Phase 2. |
| Coordinator prompt 30–40% shorter | Char-count of `renderTeamStrategyPrompt` output before vs after Phase 4. |
| Zero "AI overspawned and ran for hours" incidents in dogfood sessions after Phase 3 | Qualitative; track via `.cuekit.yaml` quota usage and absence of operator-initiated cancellations. |
| Coordinators reach for `start_team_strategy` when applicable | After Phase 2, observe via `task_events` whether strategy_hint nudges lead to subsequent strategy starts. |

## Relationship to Existing Designs

- **ADR 001 — Child reporting surface.** This design extends `task_events` with a structured optional `outcome` payload (Area 7.2). `report_task_event` remains the single child→cuekit channel.
- **ADR 002 — Grouped MCP surface.** Adds `submit_tasks` as a new grouped tool. Flat aliases remain; tool descriptions guide AI toward grouped (Area 6.2).
- **`cuekit-team-strategies-design.md`.** Prompt rendering shrinks (Area 6.1); strategy-hint discovery (Area 5.2) interacts with strategy resolution.
- **`cuekit-team-attention-items-design.md`.** `must_inspect` flag (Area 5.3) layers on top of the existing attention_items shape.
- **`cuekit-task-observability-design.md`.** `team_metrics` (Area 5.1) extends the snapshot surface.
- **`cuekit-coordinator-notifications-routing-design.md`.** Decision limit (Area 7.1) interacts with `help_requested` routing — at the limit, coordinator should `help_requested` to the parent.
- **`cuekit-adapter-run-modes-design.md`.** Echo verification (Area 3.2) needs to work across pane and batch modes consistently.

## What this design explicitly does *not* propose

- **No new adapter behaviour.** Adapter contracts are unchanged. Aider / Codex CLI adapters are separate work.
- **No TUI changes.** The TUI displays whatever cuekit produces; new fields (e.g. `team_metrics`, `must_inspect`) will show up automatically as the TUI's render logic is extended in follow-up work.
- **No release process changes.** Versioning, npm publish, Trusted Publishing remain as documented in ADR 005.
- **No conversion to autonomous loop.** All judgment stays with the parent or coordinator. The cap in Area 7.1 is enforcement-by-rejection, not enforcement-by-substitution.
