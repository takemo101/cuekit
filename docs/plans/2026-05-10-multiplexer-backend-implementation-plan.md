# Multiplexer Backend Abstraction Implementation Plan

> **For agentic workers:** REQUIRED: Use TDD for each implementation issue. Steps use checkbox (`- [ ]`) syntax for tracking. Keep PRs small and focused; each issue below should be implementable independently by an AI coding worker.

**Goal:** Implement the phased multiplexer backend abstraction so that cuekit can swap tmux for [Zellij](https://github.com/zellij-org/zellij) (and potentially other multiplexers) under a stable internal API, and enable a per-team Zellij dashboard UX where all members of a team share one tiled session.

**Architecture:** Hide today's tmux assumptions behind a `MultiplexerBackend` interface (Phase 1), generify the schema fields that name tmux explicitly (Phase 2), implement a basic `ZellijBackend` matching tmux's per-task-session model (Phase 3), then add zellij-only team-dashboard semantics where `team_id`-tagged tasks share a single `cuekit-team-<id>` session (Phase 4). Phase 5 retires the deprecation aliases.

**Tech Stack:** TypeScript, Bun test, Zod schemas from `@cuekit/core`, the existing pane adapter, FakeRunner-based tests, GitHub issues/PRs.

**Design reference:** [`docs/designs/cuekit-multiplexer-backend-design.md`](../designs/cuekit-multiplexer-backend-design.md)

---

## Phase ordering and dependencies

```
Phase 1 (refactor) ──→ Phase 2 (schema gen) ──→ Phase 3 (zellij basic)
                                                      │
                                                      ↓
                                       (deprecation window)   Phase 4 (team dashboard)
                                                      │
                                                      ↓
                                                Phase 5 (cleanup)
```

| Phase | Blocker | User-visible value |
|---|---|---|
| 1 | none | none (pure refactor) |
| 2 | Phase 1 merged | additive schema fields, no removals |
| 3 | Phase 2 merged + spike issue P3.0 closed | **users can choose `multiplexer: zellij` for solo tasks** |
| 4 | Phase 3 merged + spike issue P4.0 closed | **shared team dashboard for zellij users** |
| 5 | one minor release after Phase 2 ships | none (cleanup only) |

**Critical rule: do not bundle phases.** Each phase ships as its own set of PRs that go all the way to main before the next phase opens issues.

---

## Improvement Summary

1. **Replace tmux-coupled internals with `MultiplexerBackend`.** Same observable behaviour for tmux users; clean seam for additional backends.
2. **Schema field rename window.** `attach_hint`/`tmux_session_name` keep working, with new generic neighbours (`attach_command`, `pane_session_name`) appearing alongside.
3. **Zellij as a first-class alternate backend.** `.cuekit.yaml` `multiplexer: zellij` opt-in, project-config-only (no env override). Tmux fallback on probe failure unless `multiplexer_strict: true`.
4. **Per-task backend dispatch.** `PaneHandle.backend_kind` makes attach / steer / capture route to whichever multiplexer originally spawned the task — surviving config flips between cuekit invocations.
5. **Team dashboard is zellij-only.** When `multiplexer: zellij` AND a task has `team_id`, all members live in one shared `cuekit-team-<id>` session with auto-reflow via `swap_tiled_layout`. Tmux behaviour is unchanged.
6. **Rename-on-completion, not auto-close.** Completed team-member panes stay visible (held state) with `[<status>]` appended to their name; `cleanup_team` tears the whole session down.
7. **Two implementation spikes.** P3.0 (zellij CLI form discovery) and P4.0 (team-dashboard zellij behaviour) precede their phases.

---

## File Map (cumulative across phases)

**Phase 1 — interface introduction:**
- Create: `packages/adapters/src/multiplexer-backend.ts`
- Rename: `packages/adapters/src/pane-backend.ts` → `packages/adapters/src/tmux-backend.ts`
- Modify: `packages/adapters/src/index.ts` (re-exports + `PaneBackend` alias)
- Modify: `packages/adapters/src/{claude-code,gemini,opencode,jcode,pi}-adapter.ts` (factory signatures)
- Modify: `packages/adapters/src/build-registry.ts` (passes `MultiplexerBackend` instance)

**Phase 2 — schema generification:**
- Modify: `packages/core/src/task-status-view.ts` (add `attach_command` field)
- Modify: `packages/adapters/src/pane-adapter.ts` (write both old + new metadata fields)
- Modify: `packages/tui/src/attach.ts` (use `attachCommand` from handle)
- Modify: `packages/tui/src/data.ts` (`captureLivePaneTail` calls backend)
- Modify: `packages/cli/src/doctor.ts` (backend-aware probe + active-backend row)
- Modify: `CHANGELOG.md` (`### Deprecated` entries for `attach_hint`, `tmux_session_name`)

**Phase 3 — basic ZellijBackend:**
- Create: `packages/adapters/src/zellij-backend.ts`
- Create: `packages/adapters/src/build-multiplexer.ts`
- Modify: `packages/project-config/src/schema.ts` (add `multiplexer`, `multiplexer_strict`)
- Modify: `packages/cli/src/doctor.ts` (zellij probe row)
- Modify: `README.md`, `AGENTS.md`, `docs/guides/*` (install + pitfall + smoke)

**Phase 4 — team dashboard:**
- Modify: `packages/adapters/src/multiplexer-backend.ts` (extend `SpawnPaneParams`, add optional `onTerminalStatus` and `killTeamSession`)
- Modify: `packages/adapters/src/zellij-backend.ts` (team-session branch, rename hook, kill-team)
- Modify: `packages/adapters/src/tmux-backend.ts` (accept new params no-op)
- Modify: `packages/adapters/src/pane-adapter.ts` (thread `team_id`/`team_position` and call hook on terminal)
- Modify: `packages/mcp/src/*` (`cleanup_team` calls `killTeamSession`)
- Modify: `packages/tui/src/components/team-list.tsx` (capital-`A` shortcut)

**Phase 5 — cleanup:**
- Modify: `packages/core/src/task-status-view.ts` (remove `attach_hint`)
- Modify: `packages/adapters/src/pane-adapter.ts` (stop writing `tmux_session_name`)
- Modify: `packages/adapters/src/index.ts` (drop `PaneBackend` alias)
- Modify: `CHANGELOG.md` (`### Removed` entries)

---

## Phase 1 — `MultiplexerBackend` interface + `TmuxBackend` (refactor only)

**No behaviour change. No new feature. Pure abstraction.**

### Issue P1.1: Add `MultiplexerBackend` interface

**Outcome:** `@cuekit/adapters` exports `MultiplexerBackend`, `SpawnPaneParams`, `PaneHandle`, `CaptureOptions` types. No implementation, no callers changed.

**Files:**
- Create: `packages/adapters/src/multiplexer-backend.ts`
- Modify: `packages/adapters/src/index.ts` (re-export)

**Steps:**
- [ ] Define interface and supporting types per the design doc's "Proposed `MultiplexerBackend` interface" section.
- [ ] Add JSDoc on each method describing the contract (especially `sendKeys` newline simulation and `capturePane` null-on-failure).
- [ ] Re-export from `index.ts`.
- [ ] No tests in this issue; types alone.

**Acceptance:** `bun test --pass-with-no-tests` and `bun run typecheck` succeed; no callers reference the new interface yet.

### Issue P1.2: Move `PaneBackend` internals to `TmuxBackend`

**Outcome:** Existing `pane-backend.ts` is renamed/moved to `tmux-backend.ts` and now `implements MultiplexerBackend`. `PaneBackend` remains a type alias for backward compatibility within `@cuekit/adapters`.

**Files:**
- Rename: `packages/adapters/src/pane-backend.ts` → `packages/adapters/src/tmux-backend.ts`
- Modify: `packages/adapters/src/index.ts` (alias re-export)
- Modify: `packages/adapters/__tests__/*` (path updates only, no logic changes)

**Steps:**
- [ ] Rename file via `git mv`.
- [ ] Rename class to `TmuxBackend`; export `PaneBackend = TmuxBackend` as a type alias.
- [ ] Make `TmuxBackend implements MultiplexerBackend`. Method signatures should already match; only adjust if the existing API drifts from the interface (typically the optional fields on `SpawnPaneParams`).
- [ ] Move `TmuxRunner` import accordingly.
- [ ] Update test imports.

**Acceptance:** All existing adapter tests pass with no logic edits. `PaneBackend` type still imports from old name (alias in place).

### Issue P1.3: Adapter factories accept `MultiplexerBackend`

**Outcome:** `createClaudeCodeAdapter`, `createGeminiAdapter`, `createOpencodeAdapter`, `createJcodeAdapter`, `createPiAdapter`, and the shared `createPaneAdapter` all type their `panes` parameter as `MultiplexerBackend`. Production wiring continues to pass a `TmuxBackend`.

**Files:**
- Modify: `packages/adapters/src/{claude-code,gemini,opencode,jcode,pi}-adapter.ts`
- Modify: `packages/adapters/src/pane-adapter.ts`
- Modify: `packages/adapters/src/build-registry.ts`

**Steps:**
- [ ] Replace `PaneBackend` parameter type with `MultiplexerBackend` in all factory signatures.
- [ ] `build-registry.ts`: confirm the constructed instance is typed as `MultiplexerBackend`.
- [ ] No new tests; existing tests should pass.

**Acceptance:** Typecheck passes. Existing `FakeTmuxRunner`-based adapter tests pass unchanged. Refactor commit is behaviour-preserving.

---

## Phase 2 — Schema generification (additive, no removals)

**Backwards-compatible alias period. Both old and new fields appear simultaneously.**

### Issue P2.1: Add `attach_command` to `TaskStatusView`

**Outcome:** Every `TaskStatusView` carries a new `attach_command: { argv: string[] } | null` field alongside the existing `attach_hint: string` field. Both are populated by deriving `attach_hint` from `attach_command`'s argv.

**Files:**
- Modify: `packages/core/src/task-status-view.ts`
- Modify: `packages/adapters/src/pane-adapter.ts`

**Steps:**
- [ ] Add `attach_command` to the `TaskStatusView` schema (Zod) — optional `{ argv: string[] }` or `null`.
- [ ] In the status-view builder in `pane-adapter.ts`, populate `attach_command` from `backend.attachCommand(handle)`.
- [ ] Compute `attach_hint` as `attach_command?.argv.join(" ") ?? null` for backward compatibility.
- [ ] Snapshot test: assert both fields present and consistent.

**Acceptance:** Status views show both `attach_hint` (existing string) and `attach_command` (new structured); they agree.

### Issue P2.2: Add `metadata.pane_session_name` alias

**Outcome:** `metadata.pane_session_name` is written alongside `metadata.tmux_session_name`. Adds a `### Deprecated` CHANGELOG entry for `tmux_session_name`.

**Files:**
- Modify: `packages/adapters/src/pane-adapter.ts`
- Modify: `CHANGELOG.md`

**Steps:**
- [ ] In the metadata-writer in `pane-adapter.ts`, also set `pane_session_name` from `handle.backend_session`.
- [ ] Update one `pane-adapter` test to assert both fields.
- [ ] CHANGELOG: add `### Deprecated` entry under unreleased noting that `tmux_session_name` will be removed in a future release.

**Acceptance:** `metadata.pane_session_name` and `metadata.tmux_session_name` both appear and match.

### Issue P2.3: TUI uses `MultiplexerBackend.attachCommand`

**Outcome:** `packages/tui/src/attach.ts` builds the attach command from `backend.attachCommand(handle)` (or the new `attach_command` field on the view) instead of constructing tmux-specific argv inline.

**Files:**
- Modify: `packages/tui/src/attach.ts`

**Steps:**
- [ ] Replace `getTmuxSessionName(view)` with a `getPaneHandle(view)` helper that returns the structured `PaneHandle` (or null).
- [ ] When the user presses `a`, read `view.attach_command` (preferred) and fall back to constructing argv from the handle's backend dispatch.
- [ ] Keep tmux behaviour bit-identical.

**Acceptance:** TUI `a` shortcut still attaches to tmux sessions exactly as before. No zellij-specific code is added in this issue.

### Issue P2.4: TUI `captureLivePaneTail` goes through backend

**Outcome:** `packages/tui/src/data.ts` calls `backend.capturePane(handle, opts)` rather than spawning `tmux capture-pane` directly. The "transcript file fallback" branch is unchanged.

**Files:**
- Modify: `packages/tui/src/data.ts`
- Modify: `packages/tui/src/context.ts` (inject backend reference if not already)

**Steps:**
- [ ] Wire the `MultiplexerBackend` through `TuiContext` if needed.
- [ ] Replace direct `Bun.spawn(["tmux","capture-pane",...])` with a backend method call.
- [ ] Verify the live transcript pane still renders for tmux tasks.

**Acceptance:** TUI live transcript pane works unchanged for tmux. No zellij-specific code yet.

### Issue P2.5: `cuekit doctor` backend-aware probe

**Outcome:** `cuekit doctor` reads `multiplexer` from project config (or defaults to tmux) and probes whichever backend is configured. Always shows a one-line "active backend" row at the top.

**Files:**
- Modify: `packages/cli/src/doctor.ts`

**Steps:**
- [ ] Refactor doctor's tmux block into a backend-dispatched check.
- [ ] Add an "active backend" header row.
- [ ] Tmux probe behaviour unchanged for users on default config.

**Acceptance:** `cuekit doctor` outputs the active backend; tmux check still passes; output diff is minimal for tmux users.

---

## Phase 3 — Basic `ZellijBackend` (1 task = 1 zellij session)

**This is where solo-task zellij value lands. Team dashboard is Phase 4.**

### Issue P3.0: Spike — verify zellij CLI forms

**Outcome:** A throwaway branch + investigation issue with concrete answers to the spike questions before P3.2 begins. Result: a short markdown note posted in the issue that pins exact zellij CLI invocations.

**Files:**
- (Throwaway branch; no merged files. Notes go in the issue body.)

**Steps:**
- [ ] On a real zellij ≥ 0.44, verify: `attach --create-background <name>` exact form, `action new-pane` flags actually accepted, `action write-chars` `--pane-id` support, `action dump-screen` exact flag set, `action close-pane`, `action kill-sessions`.
- [ ] Confirm zellij version baseline (target the lowest supported).
- [ ] Post findings as the issue's resolution comment.

**Acceptance:** Issue is closed with a markdown block listing the verified CLI forms. P3.2 cites this comment.

### Issue P3.1: Add `multiplexer` config to `.cuekit.yaml`

**Outcome:** `.cuekit.yaml` accepts `multiplexer: tmux | zellij` and `multiplexer_strict: boolean`, parsed and validated. Default is `tmux`. No runtime effect yet.

**Files:**
- Modify: `packages/project-config/src/schema.ts`
- Modify: `docs/designs/cuekit-project-config-design.md` (add new fields to the schema list)

**Steps:**
- [ ] Add the two fields to the Zod schema.
- [ ] Default `multiplexer` to `"tmux"`; default `multiplexer_strict` to `false`.
- [ ] Add tests asserting parse/default/strict behaviour.

**Acceptance:** Project config tests pass with new fields parsing correctly.

### Issue P3.2: `ZellijBackend` basic implementation

**Outcome:** A working `ZellijBackend implements MultiplexerBackend` that mirrors tmux's per-task-session model: 1 task → 1 `cuekit-task-<id>` zellij session. No team awareness.

**Files:**
- Create: `packages/adapters/src/zellij-backend.ts`
- Create: `packages/adapters/__tests__/zellij-backend.test.ts`

**Steps:**
- [ ] Use the spike output (P3.0) for exact CLI forms.
- [ ] Implement `spawnPane`, `isAlive`, `sendKeys`, `capturePane`, `killPane`, `attachCommand`. All session-name patterns: `cuekit-task-<task_id>`.
- [ ] Use a `FakeZellijRunner` in tests to assert exact argv shapes.
- [ ] Real-zellij integration test gated on a `hasZellij()` helper (analogous to `hasTmux()`).

**Acceptance:** Unit tests pin argv shapes; integration test (when zellij present) submits a one-shot task and round-trips spawn → capture → kill.

### Issue P3.3: `buildMultiplexerBackend` factory

**Outcome:** A factory that reads `multiplexer` / `multiplexer_strict` from project config, runs the requested backend's `probe()`, and falls back to tmux on failure (with a one-time `logger.warn`). Strict mode hard-fails.

**Files:**
- Create: `packages/adapters/src/build-multiplexer.ts`
- Modify: `packages/cli/src/bin.ts` and `packages/mcp/src/bin.ts` (use the factory at startup)

**Steps:**
- [ ] Write the factory: requested-backend probe → fallback path → final returned backend.
- [ ] Tests: zellij present → returns zellij; zellij missing → warns + returns tmux; zellij missing + strict → throws.
- [ ] Wire into both CLI and MCP bin so the same backend is used everywhere.

**Acceptance:** All three branches (success / soft fallback / strict failure) covered by tests.

### Issue P3.4: `cuekit doctor` zellij probe

**Outcome:** `cuekit doctor` runs the zellij version probe when zellij is the configured (or fallback-detected) backend, and reports a per-backend status line.

**Files:**
- Modify: `packages/cli/src/doctor.ts`

**Steps:**
- [ ] Add a zellij probe (binary present, version ≥ baseline).
- [ ] Surface "active backend" + "fallback applied?" in output.

**Acceptance:** Doctor output covers tmux, zellij, and fallback states.

### Issue P3.5: Docs — README + AGENTS.md + smoke guide

**Outcome:** Docs explain how to opt into zellij, what fallback looks like, and add an end-to-end smoke recipe for the zellij path.

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Create: `docs/guides/zellij-backend-smoke.md`

**Steps:**
- [ ] README: install section mentions zellij as an alternative; pin the minimum supported version.
- [ ] AGENTS.md: add a pitfall row covering "zellij capture-pane formatting differs subtly from tmux".
- [ ] Smoke guide: replicate the gemini smoke pattern but exercise zellij spawn/attach/steer/kill.

**Acceptance:** Docs reviewable; smoke guide runnable.

---

## Phase 4 — Zellij team dashboard (zellij-only feature)

**Layered on top of Phase 3. tmux behaviour unchanged.**

### Issue P4.0: Spike — team-dashboard zellij behaviour

**Outcome:** The four Phase 4 spike open questions answered on real zellij before implementation begins.

**Files:**
- (Throwaway branch.)

**Steps:**
- [ ] Verify `write-chars --pane-id` support; document workaround if absent.
- [ ] Pin exact `attach --create-background` + inline-layout invocation.
- [ ] Confirm `rename-pane` of a held (exited-command) pane preserves the exit-code line.
- [ ] Confirm `new-pane` stdout reliably yields a parseable pane id.

**Acceptance:** Issue resolution lists each question's answer + reference command output.

### Issue P4.1: Extend `SpawnPaneParams` with `team_id` / `team_position`

**Outcome:** `MultiplexerBackend.SpawnPaneParams` gets two optional fields. `pane-adapter.ts` threads them from `AdapterSubmitInput`. Tmux backend ignores them.

**Files:**
- Modify: `packages/adapters/src/multiplexer-backend.ts`
- Modify: `packages/adapters/src/pane-adapter.ts`
- Modify: `packages/adapters/src/tmux-backend.ts` (no-op accept)

**Steps:**
- [ ] Add `team_id?: string` and `team_position?: TeamPosition` to `SpawnPaneParams`. Import `TeamPosition` from `@cuekit/core`.
- [ ] In `pane-adapter.ts:submit()`, pass the input's team fields through.
- [ ] Tmux backend: receive and ignore.

**Acceptance:** Typecheck passes; tmux integration tests pass with no behaviour change.

### Issue P4.2: `ZellijBackend` team-session sharing

**Outcome:** When `team_id` is set, `ZellijBackend.spawnPane` lazy-creates a shared `cuekit-team-<team_id>` session and adds the new pane to it (named `<position>:<task_id_suffix>`). Existing per-task path is unchanged.

**Files:**
- Modify: `packages/adapters/src/zellij-backend.ts`
- Modify: `packages/adapters/__tests__/zellij-backend.test.ts`

**Steps:**
- [ ] Branch on `params.team_id` at spawn-time.
- [ ] Implement `ensureTeamSession(team_id)` (idempotent; consults `zellij list-sessions` on cold start; in-memory memoisation for hot path).
- [ ] Use the spike output for the exact `new-pane` invocation; capture the returned pane id into `PaneHandle`.
- [ ] Tests: 3-member team submits → one session, three named panes; concurrent submits collapse to one create.

**Acceptance:** Integration test (real zellij) shows one `cuekit-team-<id>` session with three named panes after submitting a 3-member team in parallel.

### Issue P4.3: `onTerminalStatus` rename hook

**Outcome:** `MultiplexerBackend` gets an optional `onTerminalStatus(handle, status)` method. `ZellijBackend` implements it as `rename-pane` for team-session panes (no-op for per-task sessions). `pane-adapter.ts` calls it after `completeTask`.

**Files:**
- Modify: `packages/adapters/src/multiplexer-backend.ts`
- Modify: `packages/adapters/src/zellij-backend.ts`
- Modify: `packages/adapters/src/pane-adapter.ts`

**Steps:**
- [ ] Add `onTerminalStatus?(handle, status): Promise<void>` to interface (optional).
- [ ] `ZellijBackend.onTerminalStatus`: detect team-session via `backend_session` prefix, issue `rename-pane` with `[<status>]` suffix.
- [ ] `pane-adapter.ts`: after `completeTask`, call `backend.onTerminalStatus?.(handle, status)`.

**Acceptance:** Integration test: complete one team member, observe pane renamed to `worker:t_xxx [completed]`.

### Issue P4.4: `killTeamSession` + `cleanup_team` wiring

**Outcome:** `MultiplexerBackend` gets an optional `killTeamSession(team_id)`. `ZellijBackend` implements it as `kill-sessions cuekit-team-<id>`. The MCP `cleanup_team` handler calls it after individual cleanups.

**Files:**
- Modify: `packages/adapters/src/multiplexer-backend.ts`
- Modify: `packages/adapters/src/zellij-backend.ts`
- Modify: `packages/mcp/src/*` (the `cleanup_team` handler — locate via grep)

**Steps:**
- [ ] Add `killTeamSession?(team_id): Promise<void>` to interface.
- [ ] `ZellijBackend.killTeamSession`: issue `kill-sessions`.
- [ ] `cleanup_team` handler: after looping cleanup of member tasks, call `backend.killTeamSession?.(team_id)`.

**Acceptance:** Integration test: after `cleanup_team`, the zellij session is gone (`zellij list-sessions` does not list it).

### Issue P4.5: TUI capital-`A` team-attach shortcut

**Outcome:** Pressing `A` (Shift-`a`) on the team list attaches to the team's zellij session. For tmux teams (which are not actually shared), the shortcut falls back to attaching to the first member's per-task session — or surfaces a helpful "team attach is zellij-only" notice.

**Files:**
- Modify: `packages/tui/src/components/team-list.tsx`
- Modify: `packages/tui/src/attach.ts` (helper for team-level attach)

**Steps:**
- [ ] Add `A` key handler in the team-list keymap.
- [ ] Handler: load the team's first member, read its `attach_command`. If it's a zellij team session, attach. If tmux: show a one-line notice "team-level attach requires multiplexer: zellij".
- [ ] Keymap row in TUI help.

**Acceptance:** From team list, `A` attaches to zellij team session; tmux operators see the explanatory notice.

---

## Phase 5 — Deprecation cleanup (gated on a deprecation window)

**Open these issues only after Phase 2 has been in a tagged release for at least one minor version.**

### Issue P5.1: Remove `attach_hint` (string) field

**Outcome:** `attach_hint` is removed from `TaskStatusView`. All consumers use `attach_command`.

**Files:**
- Modify: `packages/core/src/task-status-view.ts`
- Modify: `packages/tui/src/attach.ts` (drop fallback)
- Modify: `packages/cli/src/doctor.ts` (if it referenced `attach_hint`)
- Modify: `CHANGELOG.md` (`### Removed`)

**Acceptance:** No remaining references to `attach_hint` in the codebase.

### Issue P5.2: Remove `metadata.tmux_session_name` alias

**Outcome:** `metadata.tmux_session_name` is no longer written; readers use `pane_session_name` (or the structured `pane_handle` if introduced).

**Files:**
- Modify: `packages/adapters/src/pane-adapter.ts`
- Modify: `packages/tui/src/attach.ts` (drop fallback)
- Modify: `CHANGELOG.md` (`### Removed`)

**Acceptance:** No remaining references to `tmux_session_name`.

### Issue P5.3: Drop `PaneBackend` type alias

**Outcome:** The legacy `PaneBackend` alias on `@cuekit/adapters` is removed.

**Files:**
- Modify: `packages/adapters/src/index.ts`
- Modify: any internal call sites still importing `PaneBackend`.

**Acceptance:** All adapter imports use `MultiplexerBackend` directly.

---

## Total scope and effort

| Phase | Issues | User-visible? | Indicative effort (per-issue, AI-assisted) |
|---|---|---|---|
| 1 | 3 | ❌ | 30 min – 1.5 h |
| 2 | 5 | ✅ (additive only) | 30 min – 1 h |
| 3 | 6 (incl. P3.0 spike) | ✅ | spike 2-4 h; others 30 min – 3 h; P3.2 is the largest at ~3-5 h |
| 4 | 6 (incl. P4.0 spike) | ✅ | spike 2-3 h; others 30 min – 2 h |
| 5 | 3 | ❌ | 15-30 min each |
| **Total** | **23** | mixed | ~30-40 h end-to-end including spikes |

---

## How to use this plan

1. **Do not bundle phases.** Each phase merges to main before the next phase opens issues.
2. **Spike issues first.** P3.0 must close before P3.2 starts; P4.0 must close before P4.2 starts.
3. **Phase 5 waits on a release.** Open Phase 5 issues only after Phase 2's deprecated fields have been in a tagged release for at least one minor version.
4. **Each issue should produce one PR.** TDD where possible. Refer back to the design doc (`docs/designs/cuekit-multiplexer-backend-design.md`) for any ambiguity.
5. **The implementer is allowed to deviate on details the design didn't pin** (layout exact KDL, swap-block boundaries, mutex implementation choice). The design intentionally leaves room for "simplest thing that works".
