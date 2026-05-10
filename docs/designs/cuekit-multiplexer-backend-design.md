# Design: multiplexer backend abstraction

## Status

**Phase 0 — design only.** No implementation work tied to this doc.
Phase 1+ implementation is gated on a separate decision (see
[Recommended decision path](#recommended-decision-path)) and will be
filed as its own issues / PRs if pursued.

## Problem

cuekit's pane-based adapters (claude-code, gemini, opencode, jcode, pi)
all assume tmux as the underlying terminal multiplexer. tmux is hard-
coded in three layers:

1. **Subprocess shape** — the lowest-level abstraction
   (`TmuxRunner.run(args: string[])` in
   `packages/adapters/src/tmux-runner.ts`) literally takes tmux argv.
2. **Semantic layer** — `PaneBackend`
   (`packages/adapters/src/pane-backend.ts`) builds tmux subcommands
   (`new-session`, `send-keys`, `capture-pane`, `kill-session`,
   `pipe-pane`) inline.
3. **Public surfaces** — `TaskStatusView.attach_hint` is documented
   to be a tmux command string (`tmux attach-session -t cuekit-task-<id>`),
   `metadata.tmux_session_name` carries the tmux session name, the TUI's
   live-pane fetch (`captureLivePaneTail`) shells out to `tmux
   capture-pane`, and `cuekit doctor` probes `tmux -V` and
   `tmux capture-pane`.

A user who wants to use [Zellij](https://github.com/zellij-org/zellij)
or another multiplexer cannot today. The abstraction work to allow
swapping is non-trivial because the tmux assumption has leaked all the
way to schema-level fields (`attach_hint`, `metadata.tmux_session_name`)
that downstream consumers (TUI, MCP callers) treat as load-bearing.

This design captures the abstraction shape, enumerates the affected
surfaces, and proposes a phased migration path. Implementation is
explicitly out of scope for this doc.

## Goals

- A single `MultiplexerBackend` interface that every pane adapter and
  every TUI / CLI consumer can depend on, with no tmux-specific
  knowledge above the backend.
- A drop-in `TmuxBackend implements MultiplexerBackend` that
  preserves all current behaviour (no functional change for tmux users).
- A clear path to adding a `ZellijBackend implements MultiplexerBackend`
  without touching any adapter code.
- Schema-level fields that do not name a specific multiplexer in their
  identifiers (e.g. `tmux_session_name` becomes generic).
- Backwards-compatible alias period for the renamed schema fields so
  existing MCP clients and TUI consumers do not break in lockstep.

## Non-goals

- **Multi-multiplexer-per-process.** A given cuekit process picks one
  backend at startup. We do not support running tmux and zellij
  concurrently in the same cuekit invocation.
- **Reproducing tmux's exact attach UX in zellij** (or vice versa).
  Detach key sequences and rendering cosmetics differ between
  multiplexers; we will not paper over those differences.
- **Replacing the persisted transcript file.** The file path written
  by the chosen backend stays at
  `<worktree>/.cuekit/tasks/<id>/transcript.txt`. Each backend may
  use its own underlying mechanism to populate it (tmux uses
  `pipe-pane`, zellij would use `dump-screen` polling or its
  plugin API), but the contract for transcript readers is unchanged.
- **Migrating already-running tasks.** Switching backend mid-flight is
  not supported. Operators stop, switch the configured backend, then
  start fresh.

## Proposed `MultiplexerBackend` interface

Move the semantic operations currently in `PaneBackend` to an interface,
then have `TmuxBackend` and (later) `ZellijBackend` implement it.

```ts
// Conceptual sketch — exact shape settled in Phase 1.
export interface MultiplexerBackend {
  /** Spawn a new pane running the given command. Returns a handle the
   *  backend can use later to address the pane. */
  spawnPane(params: SpawnPaneParams): Promise<PaneHandle>;

  /** Whether the backend can still see the pane (process / session
   *  alive). false → callers should treat the pane as gone. */
  isAlive(handle: PaneHandle): Promise<boolean>;

  /** Send keystrokes to the pane (steering). Treat the input as a
   *  literal string to type, with a trailing newline simulated by
   *  the backend. */
  sendKeys(handle: PaneHandle, message: string): Promise<void>;

  /** Capture the **current rendered screen** of the pane. Used by the
   *  TUI live-pane transcript path. Returns null when capture is not
   *  possible (pane gone, capture unsupported). */
  capturePane(handle: PaneHandle, opts: CaptureOptions): Promise<string | null>;

  /** Kill the pane and free any backend-side state for it. */
  killPane(handle: PaneHandle): Promise<void>;

  /** A backend-specific command line the operator can run from
   *  another shell to interactively attach to the pane. The TUI's
   *  `a` shortcut also uses this. Returns null when the backend has
   *  no attach concept (e.g. a future headless backend). */
  attachCommand(handle: PaneHandle): { argv: string[] } | null;
}

export interface SpawnPaneParams {
  task_id: string;       // canonical cuekit task id (used in handle naming)
  cwd: string;
  command: string;       // the shell command line to run inside the pane
  env?: Record<string, string>;
  transcriptPath?: string; // optional file the backend should mirror pane bytes into
}

export interface PaneHandle {
  task_id: string;       // matches SpawnPaneParams.task_id
  backend_kind: string;  // "tmux" | "zellij" | future
  backend_session?: string; // backend-specific identifier (tmux session name, zellij session, ...)
  backend_pane_id?: string; // backend-specific pane handle (tmux pane id, zellij pane id, ...)
}

export interface CaptureOptions {
  scrollbackLines?: number; // how far back into history to capture
}
```

Open detail decisions:

- `sendKeys` newline handling: today `PaneBackend.sendKeys` lets tmux
  interpret the string then sends `C-m`. zellij's `write-chars` does
  not auto-append newline. Pick one of (a) caller passes literal,
  backend simulates Enter; (b) caller includes newline; (c) two
  methods (`sendText`, `sendEnter`). Recommendation: (a), to keep
  the steering call sites unchanged.
- `attachCommand` shape: returning `{ argv }` rather than a single
  string lets the TUI's `Bun.spawn` consume it without re-tokenising.
  Operators copy-pasting the command get the joined form via a
  formatter. The current single-string `attach_hint` then becomes a
  formatter-derived field for backwards compatibility.

## Affected public surfaces

These are the schema / API points that need attention because tmux
assumptions are visible to consumers:

| Surface | Today | Proposal |
|---|---|---|
| `TaskStatusView.attach_hint: string` | `"tmux attach-session -t cuekit-task-<id>"` | Add `attach_command: { argv: string[] } \| null`. Keep `attach_hint` as a derived formatter output during a deprecation window. |
| `TaskStatusView.metadata.tmux_session_name` | tmux session name | Rename to `pane_session_name` (or `multiplexer_session_name`). Keep `tmux_session_name` as a fallback alias on read. |
| TUI `captureLivePaneTail(sessionName, opts)` | spawns `tmux capture-pane` directly | Move into `MultiplexerBackend.capturePane` and have the TUI call through the backend (already injected via `TuiContext` in spirit; see Phase 2). |
| TUI `attach.ts` (the `a` key) | builds `["tmux", "set-option", ..., ";", "attach-session", ...]` | Use `MultiplexerBackend.attachCommand(handle)` instead. |
| `cuekit doctor` | probes `tmux -V` and `tmux capture-pane` | Probe whichever backend is configured. tmux/zellij/etc. each get their own `doctor` rows. |
| `getTmuxSessionName(view)` (TUI helper) | reads `metadata.tmux_session_name` or parses `attach_hint` | Replace with `getPaneHandle(view)` returning a structured `PaneHandle` (or null). |

The schema-level renames (`attach_hint`, `tmux_session_name`) are the
only **breaking surface** changes. Everything else is internal.

## Backend selection

**Default: tmux.** Projects can opt into another multiplexer through
`.cuekit.yaml`. There is no environment variable override — the project
config is the single source of truth so the chosen backend is discoverable
and reproducible across every shell that touches the project.

```yaml
# .cuekit.yaml
multiplexer: zellij    # default is "tmux"; explicit value pins the backend
```

The `multiplexer:` key joins the existing project-config schema next to
`adapters:` and `submit:` (see
[`cuekit-project-config-design.md`](cuekit-project-config-design.md)).
Loading flow:

1. `loadProjectConfig(cwd)` returns the config; the `multiplexer` field is
   parsed (default `"tmux"`).
2. `buildMultiplexerBackend(config)` constructs the requested backend.
3. The backend's `probe()` runs at startup to confirm the multiplexer
   binary is present and the subcommands cuekit needs are recognised
   (mirrors `cuekit doctor`'s logic).
4. **If the requested backend's probe fails, fall back to tmux** with a
   warning to stderr — see [Fallback behaviour](#fallback-behaviour).

### Fallback behaviour

The motivating use case: a project has `multiplexer: zellij` in
`.cuekit.yaml`, but the operator is running cuekit on a host that does
not have zellij installed (CI, fresh laptop, container without the binary,
etc.). cuekit should not refuse to start — it should fall back to tmux
and surface a one-time warning so the operator knows what happened.

```
project config requests multiplexer "zellij" but its probe failed
(zellij: command not found). falling back to tmux. Install zellij
or set `multiplexer: tmux` in .cuekit.yaml to silence this warning.
```

Fallback rules:

- **Fallback target is always tmux.** Asymmetric on purpose: tmux is the
  baseline backend, available wherever cuekit is supported.
- **Fallback is silent in the data path** — the running task does not
  know it asked for zellij. Adapters and TUI consume the same
  `MultiplexerBackend` interface either way.
- **Fallback is loud at startup** — the warning is logged once per cuekit
  process via `logger.warn`. MCP / TUI surfaces include the active backend
  in `cuekit doctor` output and (Phase 2) in `TaskStatusView.metadata`
  so an operator can tell at a glance whether they are on the requested
  backend or fell back.
- **If tmux itself probes false**, cuekit hard-fails at startup with the
  current error path. No further fallback.
- **Operators can opt out of fallback** by setting `multiplexer: zellij`
  *and* `multiplexer_strict: true` in `.cuekit.yaml` — strict mode hard-
  fails instead of falling back. Useful for CI configs that want to
  catch a missing zellij rather than silently use tmux. Strict mode
  defaults to false.

```yaml
# .cuekit.yaml
multiplexer: zellij
multiplexer_strict: true   # optional; default false. true → no fallback to tmux.
```

### Why no env var

- The chosen backend changes the lifetime of long-running tmux/zellij
  sessions. Env-driven selection means the *same project* could end up
  with sessions split across two multiplexers depending on which shell
  spawned cuekit. That is much harder to reason about than "one project,
  one backend".
- `cuekit doctor` and the TUI need to display "active backend" without
  ambiguity. A config-file source means doctor can read the same value
  the runtime did.
- A future env override remains additively addable if a real use case
  appears (one-off dogfood, integration tests that need to force a
  specific backend regardless of project config).

## Per-task backend dispatch

A subtle but important contract: **the backend used to attach to a task
must be the backend that originally spawned it.** A pane spawned in tmux
cannot be attached to via zellij and vice versa. The design carries this
by storing `backend_kind` on every `PaneHandle` at spawn time and
threading it through every operation that addresses an existing pane:

```ts
spawnPane({task_id, ...}) → PaneHandle {
  task_id,
  backend_kind: "tmux",       // recorded at spawn, persisted for the
                              // lifetime of the task
  backend_session,
  backend_pane_id,
}

attachCommand(handle)   → uses handle.backend_kind to choose the form
                          (`tmux attach-session ...` vs `zellij attach ...`)
sendKeys(handle, msg)   → routed to the matching backend's sendKeys
capturePane(handle, …)  → same
killPane(handle)        → same
```

Persistence: the `backend_kind` (plus the backend-specific session /
pane ids in the handle) is stored on the task row so it survives the
cuekit process. Likely shape: a generic
`metadata.pane_handle: { backend_kind, backend_session, backend_pane_id }`
object, which subsumes today's `metadata.tmux_session_name`.

This means an operator who manually attaches via the
`attach_command` printed in `cuekit task status` always lands on the
right multiplexer, regardless of how many times they have toggled the
project's `multiplexer:` setting between invocations. The TUI's `a`
shortcut behaves the same way — it reads the per-task handle, not the
active backend, so a TUI launched after a config change can still
attach to in-flight tasks created under the previous setting.

### Edge case: cross-backend operations within one cuekit process

What happens when the active backend (project config = tmux) needs to
operate on a task whose handle says `backend_kind: "zellij"` (because a
previous cuekit process spawned it under a different config)?

- **Attach (`attach_command`)** is safe by default: `attachCommand` only
  needs to format an argv from the handle. The argv is a self-contained
  shell command the operator runs in another terminal — it does not
  require the cuekit process to be "using" that backend internally.
  Both the TUI's `a` shortcut and `cuekit task status` consumers can
  always print the right command.
- **Steering / cancellation / capture** require live communication with
  the spawning backend. If the active cuekit process only loaded a
  `TmuxBackend`, it cannot directly drive a zellij pane. Two options:
  - **(a) Multi-backend instance.** The process pre-loads every
    backend kind it might encounter (or lazily initialises a backend
    on first encounter) and dispatches by `handle.backend_kind`. More
    flexible but contradicts the "1 process = 1 backend" simplicity.
  - **(b) Honest error.** The process refuses cross-backend operations
    with a clear message: "this task was created with zellij; switch
    `.cuekit.yaml` back or attach manually with the printed
    attach_command." Simpler; matches the constraint that operators
    shouldn't be silently fragmenting their session graph by toggling
    the config.

  **Recommendation: (b) for v0** — the cross-backend case is rare in
  practice (operators don't usually toggle `multiplexer:` mid-project),
  the failure mode is obvious, and the right escape hatch (the printed
  attach_command) already works. Lazy multi-backend (option a) can be
  added later if a real workflow demands it.

A task whose terminal status is already final does not require any
live backend communication, so terminal tasks remain readable
(transcript file, `task_events`, `get_task_result`) regardless of
which backend is active.

## Migration plan

### Phase 1 — `MultiplexerBackend` interface + `TmuxBackend`

- Define `MultiplexerBackend`, `PaneHandle`, `SpawnPaneParams` in
  `@cuekit/adapters`.
- Move existing `PaneBackend` internals into
  `tmux-backend.ts` implementing the interface.
- `PaneBackend` keeps its current public name as a thin alias for
  backward compatibility within `@cuekit/adapters`.
- `TmuxRunner` becomes an internal of `TmuxBackend`. Test fakes
  (`FakeTmuxRunner`) move accordingly.
- Adapter factories (`createClaudeCodeAdapter`, etc.) take an
  abstract `MultiplexerBackend` argument; existing call sites pass
  `TmuxBackend` (the unchanged production wiring).

**No behaviour change. No new feature shipped to users.**

### Phase 2 — schema generification (`attach_hint`, `metadata`)

- Add `attach_command: { argv: string[] } \| null` to
  `TaskStatusView`. Continue computing `attach_hint` as a string
  derived from `attach_command` for the deprecation window.
- Add `metadata.pane_session_name` alongside the existing
  `metadata.tmux_session_name`. Backend writes both during the window;
  readers check `pane_session_name` first then fall back.
- Update TUI helpers (`getTmuxSessionName` → `getPaneHandle`).
- Update `cuekit doctor` probe to be backend-aware.
- TUI's `captureLivePaneTail` becomes a thin wrapper that calls
  `backend.capturePane(handle, ...)`.

**Breaking schema risk:** consumers (third-party MCP callers, scripts
parsing `attach_hint`) keep working because both old and new fields
appear during the window. Removal of `attach_hint` / `tmux_session_name`
should wait at least one minor release after the new fields ship.

### Phase 3 — `ZellijBackend implements MultiplexerBackend` (basic equivalence)

This phase brings zellij to **functional parity with tmux**: 1 task = 1
zellij session, no team awareness, no dashboard. Phase 4 layers
team-dashboard UX on top once the basics are proven.

- New `zellij-backend.ts` implementing the interface against the
  `zellij` CLI (target: 0.44+, which is when `--tab-id` non-destructive
  targeting and `subscribe` landed):
  - `spawnPane`: creates a per-task session named
    `cuekit-task-<task_id>` via
    `zellij attach --create-background <name> options --default-layout <inline-kdl>`,
    then immediately runs `zellij --session <name> action new-pane
    --close-on-exit -- <cmd>` in the empty layout (or runs the command
    as the session's first pane via the layout itself — exact form
    settled in the spike). Capture the returned pane id from
    `new-pane`'s stdout.
  - `sendKeys`: `zellij --session <name> action write-chars <text>`
    plus a synthetic Enter via `action write 13`.
  - `capturePane`: `zellij --session <name> action dump-screen
    --pane-id <id> --full --ansi --path <tmp>` (backend reads + cleans
    up). Output formatting differs subtly from tmux (escape sequence
    canonicalisation) — accept the difference.
  - `killPane`: `zellij --session <name> action close-pane --pane-id <id>`.
  - `attachCommand`: `["zellij", "attach", "<name>"]`.
- Backend selection wiring (`.cuekit.yaml` `multiplexer:` field +
  `multiplexer_strict`, with fallback to tmux on probe failure).
- `cuekit doctor` zellij probe (binary present, version ≥ 0.44).
- Documentation: README install section, AGENTS.md pitfall row,
  per-adapter smoke guides note that zellij is supported (without
  team-dashboard semantics).

**This is where one-task-per-session zellij value lands.** Phases 1 + 2
are pure refactor; Phase 3 alone is enough for users who just want
zellij as a tmux replacement.

### Phase 4 — Zellij team dashboard (zellij-only feature)

This phase delivers the zellij-specific UX win: when a project sets
`multiplexer: zellij` and tasks are submitted as part of a **team**
(via `submit_team_tasks` or `submit_task` with `team_id`), all member
panes live inside a **single shared zellij session** so the operator
can see the whole team in one attached terminal. tmux operators see
no behavioural change — they continue to get one tmux session per task.

#### Activation matrix

| Project config | Task has `team_id`? | Resulting session |
|---|---|---|
| `multiplexer: tmux` | yes or no | per-task tmux session (today's behaviour) |
| `multiplexer: zellij` | no | per-task zellij session (Phase 3 baseline) |
| `multiplexer: zellij` | yes | **shared team zellij session** (this phase) |

Why zellij-only: tmux's session-grouping primitives (window groups,
nested windows) do not give a clean "all team members in one tiled
view that auto-reflows on add/remove". Implementing this via tmux
would require either layout micromanagement or a separate "tmux team
window" mode that diverges far enough from current behaviour to be a
separate effort. We deliberately scope the dashboard to zellij and
treat it as a reason to choose zellij — not as a feature tmux must
catch up on.

#### Session model

- One zellij session per team: **`cuekit-team-<team_id>`**.
- Created lazily on the first pane spawn for a team via
  `zellij attach --create-background "cuekit-team-<id>" options
  --default-layout <inline-kdl>`. Subsequent member spawns reuse the
  existing session.
- One **tab** per team, named after the team's `title` (sanitised /
  truncated). Single-tab today; reserving the right to add a
  per-position tab split later (e.g., separate "workers" / "reviewers"
  tabs) without breaking the v0 layout.
- One **pane** per member task, named
  `<position>:<task_id-suffix>` (e.g., `coordinator:t_a1b2c3d4e5f6`,
  `worker:t_f6e5d4c3b2a1`). The `<position>` prefix is read from
  the task's `team_position` column (`coordinator` | `worker` |
  `reviewer` | `finisher` | `observer`).

#### Layout strategy: inline KDL with `swap_tiled_layout`

Rather than ship a layout file, the backend assembles a KDL string at
session-create time and passes it via the layout-string mechanism
(zellij 0.44.1+ supports inline layout strings). The KDL includes a
`swap_tiled_layout` block keyed on pane count:

```kdl
layout {
  tab name="<sanitised team title>" {
    pane                                // initial placeholder; first
                                        // member replaces it
  }
  swap_tiled_layout name="cuekit-team" {
    tab max_panes=2 { pane split_direction="vertical" { pane; pane } }
    tab max_panes=4 { pane split_direction="horizontal" {
                        pane split_direction="vertical" { pane; pane }
                        pane split_direction="vertical" { pane; pane } } }
    tab min_panes=5 { pane split_direction="horizontal" {
                        pane split_direction="vertical" { pane; pane; pane }
                        pane split_direction="vertical" { pane; pane; pane } } }
  }
}
```

Zellij auto-selects the appropriate swap layout as panes are added or
removed. Per zellij docs, fixed pixel sizes are explicitly unstable;
only percent / unspecified sizes are used here. The layout is
intentionally simple — Phase 4 ships a working dashboard, not a
configurable one. Operator-customisable layouts (per-team KDL files,
position-specific pane sizing, floating coordinator pane) are
deferred.

#### Adding a member pane

```bash
zellij --session cuekit-team-<team_id> action new-pane \
  --tab-id <tab_id> \
  --name "<position>:<task_id_suffix>" \
  --close-on-exit \
  -- <launch-command>
```

`--tab-id` (0.44.1+) is essential: it targets the team tab without
mutating the focused-tab state of any client currently attached to
the session. Without it, concurrent spawns from `submit_team_tasks`
could land in the wrong tab.

The backend stores the returned zellij pane id in the task's
`metadata.pane_handle` (`backend_pane_id`) plus a new
`backend_tab_id` field for the tab.

#### Removing / marking a completed member

Two viable strategies:

- **Auto-close (`--close-on-exit`)** — pane disappears immediately on
  task termination. Layout reflows to remaining live members. Operator
  loses the visual / scrollback record of completed workers, which
  is inconsistent with cuekit's transcript-file retention model
  (transcripts live until `cleanup`).
- **Rename-on-completion** — pane stays open after the task's
  command exits (zellij's "held" state, showing the exit code); the
  backend then renames the pane to
  `<position>:<task_id_suffix> [<status>]` (e.g.,
  `worker:t_xxx [completed]`, `reviewer:t_yyy [failed]`) so the
  operator can see at a glance which members are still working. The
  full team session is torn down when `cleanup_team` is called (which
  already exists per the team design).

**Decision: rename-on-completion (omit `--close-on-exit`).** Rationale:
matches transcript-retention behaviour, gives the operator a
post-mortem view, and makes "team is done when no `[running]` panes
remain" visually obvious. The renaming is driven by the existing
pane-completion path (`pane-adapter.ts`'s `status()` polling that
detects `isAlive === false` and calls `completeTask`); after
`completeTask` writes the terminal status, the backend calls
`rename-pane` with the new label. `cleanup_team` does the actual
removal via `zellij kill-sessions cuekit-team-<id>`.

#### Detection of pane death

Phase 4 keeps the existing `isAlive` polling model (consistent with
tmux). zellij offers two probe paths:

- `zellij --session <name> action list-panes --json` — returns all
  panes; if our `backend_pane_id` is absent, the pane is gone.
- `zellij --session <name> subscribe --pane-id <id> --format json` —
  event-driven `pane_closed` notifications.

`list-panes` polling is the v0 choice: shape-compatible with tmux's
polling model, no long-running subscribe process to manage. The
`subscribe` path is noted as a future optimisation if polling
overhead becomes visible (one `list-panes` call per active team per
poll cycle is bounded — teams are operator-scale, not service-scale).

#### Steering and capture for team panes

All `MultiplexerBackend` operations on team-member handles dispatch
to the team session, addressing the specific pane id:

| Op | Zellij CLI |
|---|---|
| `sendKeys(handle, msg)` | `zellij --session cuekit-team-<id> action write-chars --pane-id <handle.backend_pane_id> <msg>` then `action write --pane-id <id> 13` |
| `capturePane(handle, opts)` | `zellij --session cuekit-team-<id> action dump-screen --pane-id <handle.backend_pane_id> --full --ansi --path <tmp>` |
| `killPane(handle)` | `zellij --session cuekit-team-<id> action close-pane --pane-id <handle.backend_pane_id>` |

Spike-time confirmation needed: does `write-chars` accept
`--pane-id` in 0.44.x, or does it always target the focused pane? If
the latter, the workaround is to first issue `focus-pane --pane-id
<id>` (acceptable but mutates attached-client state cosmetically).
This is the single biggest unknown in Phase 4.

#### Attach UX

`attachCommand(handle)` for a team-member task returns
`["zellij", "attach", "cuekit-team-<team_id>"]`. The TUI's `a`
shortcut therefore lands the operator inside the shared dashboard,
not in an isolated single-pane attach. Optional follow-on: emit
`zellij --session ... action focus-pane --pane-id <id>` after attach
so the focused pane is the one the operator selected in the TUI.

A new TUI shortcut on the **team list** (Phase 4 deliverable, not
Phase 3) — `A` (capital, to distinguish from per-task `a`) — attaches
to the team session at the team level. Identical command to the
member-level `a`; offered explicitly because operators reading the
team list want to "open the dashboard" without first descending to a
member.

`zellij watch <session>` (read-only attach) is available as a future
TUI shortcut for an "observe team" mode. Out of scope for v0.

#### Interface additions (additive over Phase 3)

```ts
export interface SpawnPaneParams {
  task_id: string;
  cwd: string;
  command: string;
  env?: Record<string, string>;
  transcriptPath?: string;
  // New in Phase 4 — zellij backend reads these to choose between
  // per-task session and shared team session. Tmux backend ignores them.
  team_id?: string;
  team_position?: TeamPosition;       // imported from @cuekit/core
}

export interface PaneHandle {
  task_id: string;
  backend_kind: string;
  backend_session?: string;
  backend_pane_id?: string;
  // New in Phase 4. Only meaningful when the backend uses tabs (zellij).
  // Set when the pane is part of a multi-pane tab so close / rename
  // operations can target the right tab on hosts where tab id is required.
  backend_tab_id?: string;
}

export interface MultiplexerBackend {
  // ... Phase 1 methods
  /** Optional: tear down all panes / state for an entire team in one
   *  call. Backends without team-aware grouping (tmux today) implement
   *  this as iterate-and-killPane over the team's task ids. */
  killTeamSession?(team_id: string): Promise<void>;
}
```

#### Concurrent spawn safety

`submit_team_tasks` is the worst case: N members spawned in parallel,
all hitting `ZellijBackend.spawnPane`. Two race surfaces:

1. **Session creation** — N concurrent calls all try to create
   `cuekit-team-<id>`. Mitigation: an in-process `Map<team_id,
   Promise<TabId>>` memoises the create call, so only the first
   spawn does the `attach --create-background` and the rest await.
   On process restart, `zellij list-sessions` is consulted to detect
   an already-existing session before recreating.
2. **Tab creation timing** — even with `--tab-id`, zellij needs the
   tab to exist before `new-pane --tab-id` can target it. The
   memoised create returns the tab id, so dependent spawns block on
   it.

This is the main piece of state Phase 4 adds inside the backend: a
team-session registry keyed by `team_id`, holding `{session_name,
tab_id, create_promise}`. It is purely an in-process cache — the DB
remains the source of truth via `metadata.pane_handle`.

#### Failure / fallback behaviour

- **Zellij version too old (< 0.44.1):** Phase 4 hard-fails the team
  spawn with a clear error pointing the operator at upgrading. No
  silent downgrade to "per-task zellij sessions" — the request to
  spawn a team member into a dashboard is too divergent from "spawn
  one isolated session" to silently switch.
- **Project switches `multiplexer: zellij` → `multiplexer: tmux`
  mid-team:** existing team-member tasks keep their stored
  `backend_kind: "zellij"` and remain attachable (per the existing
  cross-backend dispatch contract). New team members under the new
  config spawn as per-task tmux sessions; they do not join the
  abandoned zellij team session. The operator effectively has a
  partially-orphaned dashboard until the original tasks complete and
  cleanup runs. Document this; do not try to reconcile.
- **Operator manually kills a member pane via zellij UI:** detected
  by `isAlive` polling on the next cycle, task transitions to a
  cancelled-equivalent terminal status. No special handling needed;
  matches the equivalent tmux operator-kill-pane case.

#### Out of scope for Phase 4 (tracked, not blocking)

- Floating coordinator pane (`--floating --pinned`) layered above
  the worker grid.
- Per-team layout customisation via `.cuekit.yaml` (e.g.,
  `team_layout: cockpit-style.kdl`).
- Custom WASM status-bar plugin showing live cuekit team metadata.
- Event-driven completion via `zellij subscribe` (replace polling).
- Multi-tab teams (e.g., separate "workers" and "reviewers" tabs).
- Read-only "observe" attach mode.
- Cross-team aggregation (e.g., "show every active team in one
  zellij session"). Out of scope; one zellij session per team
  remains the contract.

#### Open questions for the implementation spike

1. Does `zellij action write-chars` accept `--pane-id` in 0.44.x? If
   not, what is the cleanest workaround (`focus-pane` then
   `write-chars`, or session-level write)?
2. What is the exact form for `zellij attach --create-background`
   with an inline layout string in 0.44.x? Docs name the flag but
   the precise positional form (`options --default-layout` vs
   `--layout-string`) varies between minor releases.
3. Does `--close-on-exit` interact with `swap_tiled_layout`
   reflow predictably when many panes close in quick succession?
4. Can we reliably parse the `new-pane` stdout to extract a stable
   pane id, or does that vary by zellij build flags?

These are spike-and-confirm items, not design-blocking, but the spike
must precede full Phase 4 implementation.

### Phase 5 — deprecation + cleanup

- Remove `attach_hint` (string) and `metadata.tmux_session_name`
  fields once the deprecation window has passed.
- Drop the legacy `PaneBackend` alias.

## Trade-offs and open risks

### Backend behavioural differences

- **Detach key**: tmux defaults to `Ctrl-b d`; zellij defaults to
  `Ctrl-q`. The TUI's `a` shortcut docs ("attach to tmux session
  (one-way; exits TUI)") will need to either be backend-aware or
  drop the multiplexer-specific verbiage.
- **Pane-vs-session topology**: tmux puts each cuekit task in its own
  session (`cuekit-task-<id>`); zellij's session model is not 1:1.
  Resolved across Phase 3 + 4: Phase 3 mirrors tmux (one zellij
  session per task) for solo tasks; Phase 4 introduces a shared
  per-team session (`cuekit-team-<team_id>`) for tasks that have a
  `team_id`. The `backend_session` field on `PaneHandle` carries
  whichever was used at spawn time, so attach / steer / capture
  always route correctly.
- **Capture API**: tmux's `capture-pane -p -e -J` writes to stdout in
  one shot. zellij's `dump-screen` writes to a file path; the
  backend reads + deletes. Capture output formatting will differ
  subtly (whitespace, escape preservation).
- **Live transcript via `pipe-pane`**: zellij has no equivalent of
  tmux's per-pane stdout pipe. The persisted `transcript.txt` would
  need a different population strategy on zellij — periodic
  `dump-screen` snapshots, or a plugin-based approach. This may
  mean the persisted-file shape under zellij is slightly different
  (frame snapshots vs continuous stream). Acceptable for v0 zellij
  support; document the difference.

### Schema migration friction

The `attach_hint` and `metadata.tmux_session_name` fields are read by:

- The TUI (controlled — we update at the same time).
- `cuekit doctor` (controlled).
- External MCP callers (uncontrolled — this is the real concern).
- Operator shell scripts (uncontrolled).

Phase 2's deprecation window mitigates this. We must NOT remove the
old fields in the same release as the new ones — at least one minor
release apart, with `### Changed` + `### Deprecated` callouts in the
CHANGELOG for both releases.

### Scope creep

A real risk: once we have a `MultiplexerBackend` interface, contributors
will be tempted to add backends for screen, byobu, dvtm, etc. None of
those are well-supported targets and each would dilute test coverage.

**Decision:** the interface is publicly visible but the curated set of
shipped backends stays small (tmux, possibly zellij, nothing else
without a strong use case). Document this boundary in
`@cuekit/adapters` README.

### YAGNI for a one-user feature

Today only the user-reporter actively wants zellij. No broader pull
yet. If Phase 3 (the actual zellij backend) does not happen, Phases
1 + 2 still leave a cleaner architecture, but they are pure
refactor work with no user-visible benefit. That is acceptable for the
abstraction-cleanup angle but means the value/cost ratio is sensitive
to whether zellij actually ships.

## Recommended decision path

1. **Land this design doc as Phase 0** (this PR). No implementation.
2. **Make a separate decision** on whether to proceed with Phase 1.
   The decision factors:
   - Does the user actively need zellij now, or is it a "nice to
     have, eventually"?
   - Are there other higher-priority items in the queue?
   - Is the schema-rename window cost (Phase 2 deprecation) worth
     paying for the cleaner abstraction?
3. **If Phase 1 lands**, file Phase 2 separately. Do not bundle.
4. **Phase 3 (basic zellij backend) is a separate decision** after
   Phase 2. It can also be punted indefinitely if no real demand
   emerges.
5. **Phase 4 (team dashboard) is gated on Phase 3 shipping.** Even if
   the user is excited about the dashboard UX, do not skip Phase 3 —
   debugging "is this a basic-zellij issue or a dashboard-layout
   issue" gets much harder when both land at once. After Phase 3
   stabilises, run the implementation spike for the four open
   questions in [Phase 4](#phase-4--zellij-team-dashboard-zellij-only-feature)
   before committing the full Phase 4 work.

The goal of this doc is to make those decisions cheap and informed,
not to commit to any of them.

## Implementation files (when phases proceed)

| Phase | Files |
|---|---|
| 1 | `packages/adapters/src/multiplexer-backend.ts` (new), `packages/adapters/src/tmux-backend.ts` (new, moved from `pane-backend.ts`), `packages/adapters/src/index.ts` (export), per-adapter wiring kept unchanged via type alias. |
| 2 | `packages/core/src/task-status-view.ts` (add `attach_command`, `metadata.pane_session_name`), `packages/tui/src/attach.ts` (`getTmuxSessionName` → `getPaneHandle`), `packages/tui/src/data.ts` (`captureLivePaneTail` → backend call), `packages/cli/src/doctor.ts` (backend-aware probe), CHANGELOG `### Deprecated` entries. |
| 3 | `packages/adapters/src/zellij-backend.ts` (new), `packages/adapters/src/build-multiplexer.ts` (new — reads `multiplexer` / `multiplexer_strict` from project config, runs the backend's `probe()`, falls back to tmux on failure with a one-time `logger.warn`), `packages/project-config/src/schema.ts` (`multiplexer` and `multiplexer_strict` fields), `cuekit doctor` zellij probe + "active backend" row, AGENTS.md / README updates. |
| 4 | `packages/adapters/src/zellij-backend.ts` (extend with team-session registry, `team_id`/`team_position`-aware `spawnPane`, inline KDL layout assembly with `swap_tiled_layout`, `--tab-id`-aware `new-pane`, rename-on-completion), `packages/adapters/src/multiplexer-backend.ts` (extend `SpawnPaneParams` with `team_id`/`team_position`, extend `PaneHandle` with `backend_tab_id`, optional `killTeamSession`), `packages/adapters/src/pane-adapter.ts` (thread `team_id` / `team_position` from `AdapterSubmitInput` into `spawnPane`), `packages/adapters/src/tmux-backend.ts` (no-op accept of new params for forward compatibility), `packages/tui/src/components/team-list.tsx` (add capital-`A` "attach team session" shortcut wiring), `packages/tui/src/attach.ts` (use `attachCommand` from handle, no zellij-specific code), `cuekit cleanup_team` MCP path (`packages/mcp/src/`) wires to `killTeamSession` when present. |
| 5 | Removal of legacy aliases; CHANGELOG `### Removed` entry. |

## Test plan (when phases proceed)

- Phase 1: existing `FakeTmuxRunner`-based tests keep passing
  unchanged (= refactor is behaviour-preserving).
- Phase 2: snapshot tests assert `attach_hint` (legacy) and
  `attach_command` (new) both appear and agree; readers prefer the
  new one.
- Phase 3: a `hasZellij()` gate analogous to `hasTmux()`; the
  existing live-pane integration tests run twice — once per backend
  — when both are available.
- Phase 4: a `FakeZellijRunner` exercising the team-session registry
  (concurrent `submit_team_tasks` collapse to one
  `attach --create-background`, subsequent spawns reuse the cached
  tab id, killing the team via `cleanup_team` issues exactly one
  `kill-sessions`). Plus an integration test against a real zellij
  ≥ 0.44.1 (gated on the same `hasZellij()` probe) that:
  (a) submits a team with three workers,
  (b) asserts a single `cuekit-team-<id>` session contains three
      panes named with the right `worker:` prefix,
  (c) completes one worker and asserts its pane is renamed to
      `... [completed]` (not closed),
  (d) calls `cleanup_team` and asserts the zellij session is gone.

## When to revisit this design

- A second user asks for zellij or another multiplexer — bumps the
  Phase 3 priority.
- A tmux change breaks one of the cuekit-internal subprocess calls in
  a way that would have been easier to isolate behind the abstraction.
- A new adapter (sixth runtime) has multiplexer-specific needs.

If none of those happen for several months, this doc can be marked
"deferred indefinitely" rather than withdrawn — the analysis itself
remains useful for any future revisit.
