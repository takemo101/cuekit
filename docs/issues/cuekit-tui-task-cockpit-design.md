# Design: `cuekit tui` task cockpit

## Background

cuekit's normal CLI output is optimized for agents and scripts. The default TOON output is compact and machine-readable, and `--format json` remains available for strict machine processing. Human operators, however, need a better way to watch running child agents, inspect task details, and take common actions without composing many individual commands.

`cuekit tui` is the human-facing cockpit for that workflow. It is a separate operator surface; it must not replace the TOON-oriented CLI/MCP protocol surface.

## Goals

- Show an interactive task list and selected task details.
- Let users inspect events and transcript tail for the selected task.
- Let users attach to a selected running task's tmux session.
- Let users run common actions on the selected task: refresh, cancel, delete, steer.
- Reuse existing cuekit command-layer functions and schemas where possible.
- Keep implementation scoped enough for an MVP.

## Non-goals for v1

- New task submission from the TUI.
- Session dashboard / session deletion UI.
- Adapter management UI.
- Complex filtering/search.
- Returning to the TUI after tmux attach.
- Replacing TOON/JSON command output.

## Library choice

Use OpenTUI for the initial implementation.

Local reference material:

- [OpenTUI reference index](../references/opentui/README.md)
- [Getting started](../references/opentui/01-getting-started.md)
- [Renderer](../references/opentui/02-renderer.md)
- [Layout](../references/opentui/05-layout.md)
- [Keyboard](../references/opentui/06-keyboard-console-colors.md)
- [React bindings](../references/opentui/13-bindings-react.md)

Rationale:

- cuekit already targets Bun, and OpenTUI is currently Bun-first.
- OpenTUI powers OpenCode in production, which is one of cuekit's core adapters.
- The planned cockpit is a real TUI with panes, keyboard actions, and live refresh; OpenTUI is a better conceptual fit than plain formatted CLI output.
- React bindings allow a component/state model similar to Ink while keeping OpenTUI's richer renderer.

Expected dependencies:

```sh
bun add @opentui/core @opentui/react react
bun add -d @types/react
```

## Command surface

Add a human-only command:

```sh
cuekit tui
```

This command is not an MCP tool. It should be registered only in the human CLI projection, not in `CUEKIT_OPERATIONS`, because it is an interactive terminal program rather than a request/response protocol operation.

Implementation entry points:

- `packages/mcp/src/bin.ts` detects `process.argv[2] === "tui"` before `cli.serve()` and launches the TUI.
- `packages/mcp/src/tui/index.tsx` exports `runTui(ctx)`.
- Existing MCP/CLI command handlers remain unchanged.

## Layout

Initial layout:

```text
┌ Tasks ───────────────────────────────┐┌ Detail ──────────────────────────────┐
│ t_abc  running    opencode      12s ││ Task: t_abc                           │
│ t_def  completed  claude-code   2m  ││ Agent: opencode                       │
│ t_xyz  failed     pi            5m  ││ Status: running                       │
│                                      ││ Attach: tmux attach-session -t ...    │
└──────────────────────────────────────┘│                                      │
                                        │ Events                               │
                                        │ - progress: ...                      │
                                        │ - completed: ...                     │
                                        │                                      │
                                        │ Transcript tail                      │
                                        │ ...                                  │
                                        └──────────────────────────────────────┘

[r] refresh  [a] attach  [s] steer  [c] cancel  [d] delete  [q] quit
```

Responsive behavior:

- Wide terminal: two-pane layout, tasks left and detail right.
- Narrow terminal: prioritize task list and compact selected detail; transcript tail may be hidden behind a key toggle in a later iteration.
- Footer always shows key bindings and latest status/error message.

## Data model

TUI state should derive from command-layer snapshots, not direct ad-hoc SQL where avoidable.

Suggested internal state:

```ts
type TuiState = {
  tasks: TaskSummary[];
  selectedIndex: number;
  selectedStatus?: TaskStatusView;
  selectedEvents: TaskEvent[];
  transcriptTail: string[];
  loading: boolean;
  message?: string;
  error?: string;
};
```

Data loading:

- `refresh()` calls `runListTasks(ctx, { limit: 100 })`.
- For selected task:
  - `runGetTaskStatus(ctx, { task_id })`
  - `runListTaskEvents(ctx, { task_id })`
  - read transcript tail from `result.artifacts` when terminal, or from task artifact path if available through status/result metadata in a later iteration.

For v1, transcript tail can be best-effort:

- show transcript path if known.
- show last N lines when the path exists.
- otherwise show `No transcript available yet`.

## Keyboard actions

Required v1 keys:

| Key | Action |
| --- | --- |
| `↑` / `k` | select previous task |
| `↓` / `j` | select next task |
| `r` | refresh task list and selected detail |
| `a` | attach to selected task's tmux session and exit TUI |
| `s` | prompt for steering message and call `runSteerTask` |
| `c` | cancel selected non-terminal task after confirmation |
| `d` | delete selected terminal task after confirmation |
| `q` / `Esc` | quit |

Optional v1.1 keys:

| Key | Action |
| --- | --- |
| `e` | toggle event-focused view |
| `t` | toggle transcript-focused view |
| `?` | show help overlay |

## Attach behavior

The user explicitly chose one-way attach for v1.

When `a` is pressed:

1. Verify selected task has `supports_attach` and an `attach_hint`.
2. Destroy/suspend the OpenTUI renderer cleanly so terminal state is restored.
3. Execute the tmux attach command with inherited stdio.
4. Do not return to the TUI after detach.

Preferred implementation:

- Parse `metadata.tmux_session_name` when available and spawn:

```ts
Bun.spawn(["tmux", "attach-session", "-t", sessionName], { stdio: ["inherit", "inherit", "inherit"] });
```

- If only `attach_hint` is available, avoid shell execution when possible; parse the expected `tmux attach-session -t <name>` shape.
- If attach is unavailable, keep the TUI open and show a footer error.

## Mutating actions

All mutating actions should route through existing command-layer functions:

- cancel: `runCancelTask`
- delete: `runDeleteTask`
- steer: `runSteerTask`

Do not duplicate lifecycle or permission logic inside the TUI.

Confirmation rules:

- `c` requires confirmation for non-terminal tasks.
- `d` requires confirmation and is only offered for terminal tasks.
- `s` opens a text input prompt; empty message cancels.

After a successful action, refresh state and show a footer message.

## Error handling

- Command-layer structured errors should be shown in the footer/detail panel.
- TUI should keep running after recoverable operation errors.
- Renderer cleanup must happen on `q`, `Esc`, Ctrl+C, attach, and process signals.
- If OpenTUI throws during startup, fall back to a concise stderr message and non-zero exit.

## Refresh model

MVP can use manual refresh only.

Optional auto-refresh can be added later:

- default interval: 2s while running tasks exist.
- pause auto-refresh while an input/confirmation dialog is active.
- always allow `r` for immediate refresh.

Manual-first keeps v1 simpler and avoids surprising DB/tmux polling.

## Package structure

Suggested files:

```text
packages/mcp/src/tui/
  index.tsx              # runTui(ctx)
  app.tsx                # top-level state and keyboard routing
  data.ts                # command-layer data loaders and transcript-tail helper
  attach.ts              # one-way tmux attach helper
  components/
    task-list.tsx
    task-detail.tsx
    footer.tsx
    confirm-dialog.tsx
    input-dialog.tsx
```

Keep TUI-specific formatting and keyboard behavior under `src/tui/`. Shared protocol behavior belongs in the existing command layer.

## Testing strategy

Unit-test non-rendering pieces first:

- task selection bounds.
- attach command parsing / session-name extraction.
- action enablement rules (`canAttach`, `canCancel`, `canDelete`).
- data loader behavior using the in-memory DB and fake tmux runner.

For OpenTUI rendering itself, start with smoke coverage if feasible:

- `runTui` module imports without throwing.
- command registration recognizes `cuekit tui --help` or equivalent if a help path is added.

Avoid brittle snapshot tests of full terminal output in v1.

## Rollout plan

1. Add OpenTUI references and documentation links. Done.
2. Add `cuekit tui` design note. This document.
3. Spike a read-only TUI with task list, detail pane, refresh, and quit.
4. Add one-way tmux attach.
5. Add cancel/delete/steer actions with confirmation/input prompts.
6. Dogfood against real OpenCode and Claude Code tasks.
7. Update README with `cuekit tui` usage.

## Open questions

- Should `cuekit tui` default to all tasks or only tasks for the current cwd?
  - Recommendation: default to current cwd for human relevance, with a future `--all` option.
- Should terminal completed tasks remain visible by default?
  - Recommendation: yes for v1, because operators often want recent results.
- How many transcript lines should be shown?
  - Recommendation: last 80 lines, truncated by panel height.
