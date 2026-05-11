# Design: Herdr multiplexer backend

## Status

Proposed. This note designs an experimental `herdr` implementation of cuekit's existing `MultiplexerBackend` contract. It intentionally focuses on the object mapping and lifecycle semantics before implementation.

## Context

cuekit currently abstracts terminal multiplexers behind `MultiplexerBackend` in `@cuekit/adapters`. The existing production backends are `tmux` and `zellij`; project selection is configured with `.cuekit.yaml`:

```yaml
multiplexer:
  backend: zellij # or tmux today; herdr proposed here
  strict: false
```

[Herdr](https://github.com/ogulcancelik/herdr) is a terminal-native agent multiplexer with persistent sessions, workspaces, tabs, panes, agent status detection, and a local Unix socket API. The socket/CLI surface provides the operations cuekit needs: create workspaces/tabs, split panes, run commands, send input, read pane output, wait for output/status, report agent state, close panes, and attach to a persistent herdr session.

## Goals

- Add a third backend kind, `herdr`, without changing cuekit's adapter-facing `MultiplexerBackend` interface.
- Preserve cuekit's current task semantics: spawn, attach, steer, capture, cancel, restore after process restart, and team cleanup.
- Use Herdr's workspace/tab/pane model in a way that is understandable for humans attaching to a long-lived session.
- Keep the first implementation small and testable: solo tasks first, then team-aware layout.

## Non-goals

- Replacing cuekit teams with Herdr's UI model. Herdr is only the terminal substrate; `task_events` remains cuekit's canonical state.
- Introducing a workflow scheduler or auto-steering behavior.
- Migrating existing tmux/zellij tasks into Herdr.
- Guaranteeing exact tmux/zellij visual equivalence. Herdr's attach UX opens a Herdr session, not a single-pane attach.

## Herdr model summary

Herdr exposes four relevant levels:

| Herdr object | Meaning | Persistence / stability notes |
|---|---|---|
| session | Runtime/socket namespace for a persistent Herdr server. | Named sessions are stable; each session has its own sockets and state. |
| workspace | Human-facing project/task/team group. | Workspace IDs are opaque and stable for the life of the workspace. |
| tab | First-class subdivision inside a workspace. | Tab IDs include the workspace id and a compact tab number. |
| pane | Real terminal running a shell/agent/command. | Pane IDs are public compact IDs and can compact when panes close; do not treat old IDs as globally durable without validation. |

The important design implication: unlike tmux and solo zellij, cuekit cannot derive the live Herdr pane from `task_id` alone. The backend must persist and restore the Herdr coordinates returned by the socket API.

## Mapping strategy

### Runtime namespace

Use one Herdr named session per cuekit project/runtime namespace:

```text
herdr session = ck-<project-id-or-cwd-hash>
```

The first implementation can derive this from the project config id when available, otherwise from a stable hash of `cwd`. The session name must satisfy Herdr's session-name rules: ASCII letters, numbers, `.`, `_`, and `-`; `default` is reserved.

Rationale:

- Avoids creating one OS-level Herdr server per task.
- Keeps all cuekit-managed panes for a project visible in one human-facing Herdr UI.
- Keeps attach simple: `herdr --session <session>`.

### Solo tasks

For a non-team task:

```text
cuekit task
  -> Herdr session: ck-<project>
  -> Herdr workspace: task <task_id> [short label]
  -> Herdr tab: default tab
  -> Herdr pane: root pane running the task command
```

This is the safest initial mapping because closing or compaction of sibling panes is unlikely to disturb a one-task workspace.

### Team tasks

For a team member task:

```text
cuekit team
  -> Herdr session: ck-<project>
  -> Herdr workspace: team <team_id> [short objective]
  -> Herdr tab: default tab initially
  -> Herdr pane: one pane per cuekit task
```

Phase 2 may add role-oriented tabs:

```text
team workspace
  tab: coordinator
  tab: workers
  tab: review
  tab: finish
```

However, the first team-aware implementation should use a single tab to reduce restore and focus complexity. Role tabs are a UX improvement, not a core backend requirement.

## Persisted native task reference

Persist the owner backend and Herdr coordinates in `native_task_ref`:

```text
herdr:<session>/<workspace_id>/<tab_id>/<pane_id>
```

Example:

```text
herdr:ck-cuekit/w64e95948145ed1/w64e95948145ed1:1/w64e95948145ed1-1
```

The corresponding `PaneHandle` should contain:

```ts
{
  task_id,
  backend_kind: "herdr",
  backend_session: "ck-cuekit",
  backend_pane_id: "w64e95948145ed1/w64e95948145ed1:1/w64e95948145ed1-1",
  backend_label: "task t_abc" // optional
}
```

`backend_pane_id` uses a slash-separated Herdr coordinate because the generic `PaneHandle` currently has only one backend pane field. The Herdr backend should parse this into `{ workspaceId, tabId, paneId }` internally.

## Restore behavior

`HerdrBackend.restorePaneHandle(handle)` must parse the persisted coordinate and populate an internal task handle map.

When operating on a restored task:

1. Try `pane.get(pane_id)`.
2. Verify that the returned pane still belongs to the expected `workspace_id` and `tab_id` when present.
3. If `pane.get` fails, query `pane.list` filtered by workspace, if the Herdr API/CLI supports the filter in the installed version.
4. If exactly one plausible pane remains in the expected workspace for this task, the backend may refresh the in-memory handle.
5. Otherwise treat the pane as not alive and let cuekit fall back to transcript/task-event state.

Do not silently steer or kill a different pane just because a compact public pane ID now exists. If validation fails, return a clear dead/mismatch result.

## Backend operations

### `sessionNameFor(task_id)`

Return the Herdr project session name. This differs from tmux/zellij where `sessionNameFor` often returns a per-task session. For status metadata, `pane_session_name` will be the Herdr session name; the pane/workspace coordinate is exposed through `backend_pane_id` / `native_task_ref`.

### `spawnPane(params)`

Solo task flow:

1. Ensure the Herdr binary exists: `herdr --version` or `herdr status client`.
2. Ensure the named Herdr server/session is running. Prefer socket API readiness when available; CLI fallback is acceptable.
3. Create a workspace in the named session with `cwd = params.cwd`, label `task <task_id>`.
4. Use the root pane returned by `workspace.create`.
5. Run `params.command` in that pane with `pane.run` / `pane.send_input` + Enter.
6. Persist `session/workspace_id/tab_id/pane_id` in the returned `PaneHandle`.

Team task flow:

1. Ensure a team workspace exists for `team_id`, creating it when absent.
2. For the first member, use the root pane.
3. For additional members, split from a known live pane with `pane.split --direction right|down` and run the command in the new pane.
4. Store each task's returned coordinate.

Failure handling:

- If command injection fails after creating a solo workspace, close the workspace or root pane when safe.
- If team member pane creation fails, close only the newly-created pane; do not delete the whole team workspace.
- Never include child reporting tokens in command-line args, labels, or logs. Pass them only through environment if Herdr exposes an env-aware run API; otherwise use the existing cuekit launch-script pattern that sources a `0600` temp env file before running the command.

Open implementation detail: Herdr's current CLI `pane.run <pane_id> <command>` sends text into an existing shell. If Herdr does not offer an env-bearing spawn API, `HerdrBackend` should generate a temporary launch script similar to `ZellijBackend` and run `sh <launchScriptPath>` in the pane.

### `isAlive(task_id)`

A task is alive if:

- the restored Herdr session is reachable;
- `pane.get(pane_id)` succeeds;
- the pane still validates against the expected workspace/tab coordinate.

Herdr agent status (`working`, `blocked`, `done`, `idle`, `unknown`) is useful for display but should not replace pane existence for cuekit liveness. A shell can be idle while the task process is still attachable.

### `sendKeys(task_id, message)`

Use `pane.send_input` with the literal message and a real Enter key:

```json
{
  "method": "pane.send_input",
  "params": {
    "pane_id": "...",
    "text": "<message>",
    "keys": ["Enter"]
  }
}
```

This matches the current backend contract: callers pass a literal message and the backend appends/submits newline semantics.

### `capturePane(task_id, opts)`

Use Herdr `pane.read`:

- default source: `recent`
- line count: `opts.scrollbackLines ?? 200`
- format: text for normal capture; ANSI can be considered later for richer TUI rendering.

`visible` is closer to a rendered screen, while `recent` is closer to tmux capture with scrollback. For cuekit's TUI task detail, `recent` is the safer default because it retains more context.

### `killPane(task_id)`

For solo task workspaces, close the workspace or pane. Prefer workspace close if the workspace is cuekit-owned and contains only that task.

For team task panes, close only the member pane. Team workspace cleanup belongs to `killTeamSession(team_id)` / team cleanup paths.

Missing pane/session should be treated as idempotent success when cancelling an already-gone task.

### `attachCommand(task_id)`

Return a session-level attach command:

```ts
{ argv: ["herdr", "--session", sessionName] }
```

If Herdr later exposes a stable CLI focus command, cuekit can add pre-attach focus support in the TUI similar to zellij's team-pane focus hook. Until then, attaching opens the correct Herdr session and the user can select the workspace/pane visually.

### `markPaneTerminal(task_id, status)`

Optional initial behavior: no-op.

Future enhancement: use Herdr pane labels or `pane.report_agent` / `pane.release_agent` to surface cuekit status in Herdr's sidebar. This must remain derived display state; cuekit `task_events` remain canonical.

### `killTeamSession(team_id)`

Close the team workspace when it is empty or when cleanup explicitly asks to remove cuekit-owned team UI. Do not stop the entire Herdr session unless cuekit owns no remaining workspaces in that session.

## Socket/CLI integration layer

Add a focused runner module, analogous to `tmux-runner.ts` and `zellij-runner.ts`:

```ts
export interface HerdrRunner {
  run(args: string[], options?: { env?: Record<string, string> }): Promise<HerdrRunResult>;
  request<T>(session: string, request: HerdrRequest): Promise<T>;
}
```

The first implementation can use CLI wrappers for simplicity, but socket JSON is preferable for robust parsing because most Herdr methods already expose request/response JSON.

Testing should use a fake runner that simulates workspaces/tabs/panes and intentionally compacts pane IDs on close to verify restore safety.

## Project config and fallback

Extend the project config schema:

```ts
export const MultiplexerSchema = z.enum(["tmux", "zellij", "herdr"]);
```

Extend `buildMultiplexerBackend`:

- requested `herdr` probes `herdr --version` or `herdr status client`;
- if probe succeeds, return `new HerdrBackend()`;
- if probe fails and `strict` is false, fall back to tmux with a Herdr-specific warning;
- if `strict` is true, hard-fail.

This preserves the existing zellij fallback semantics.

## Phased implementation

### Phase 1 — solo experimental backend

- Config accepts `multiplexer.backend: herdr`.
- `HerdrRunner` fake + production CLI/socket runner.
- `HerdrBackend` supports solo task spawn, restore, alive, steer, capture, kill, attach.
- `native_task_ref` uses `herdr:<session>/<workspace>/<tab>/<pane>`.
- Unit tests cover command mapping and restore mismatch safety.

### Phase 2 — team workspace support

- `team_id` tasks share one Herdr workspace.
- Additional team members split panes in the team workspace.
- `killTeamSession` closes cuekit-owned team workspace.
- Tests cover multiple team members and cleanup.

### Phase 3 — UX polish

- Role-oriented tabs for coordinator/workers/review/finish.
- Optional Herdr agent-status reporting integration.
- TUI pre-attach focus if Herdr provides a stable focus CLI/API.
- Docs guide and opt-in real Herdr integration suite.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Pane IDs compact after close. | Persist full coordinate, validate workspace/tab before operations, never steer mismatched pane. |
| Herdr CLI lacks env-bearing command spawn. | Use cuekit-owned temp env + launch script; run only `sh <script>` in the pane. |
| Attach does not focus exact task pane. | Treat attach as session-level for Phase 1; add focus pre-step only when Herdr exposes stable support. |
| Herdr server lifecycle differs from tmux/zellij. | Encapsulate startup/probe/socket readiness in `HerdrRunner`; keep backend semantics unchanged above that layer. |
| Team pane layout complexity. | Ship solo backend first; add team workspace in a separate phase; role tabs are optional polish. |

## Open questions before implementation

1. Should Herdr session naming use project id, cwd hash, or both? Recommendation: `ck-<project-id>` when configured, else `ck-<cwd-hash>`.
2. Should solo task cancellation close the whole workspace or only the root pane? Recommendation: close the workspace when cuekit created it and it has no non-cuekit panes.
3. Should capture use `recent` or `visible`? Recommendation: `recent` initially for context, with possible TUI-specific `visible` later.
4. Should first team support use one tab or role tabs? Recommendation: one tab first.
