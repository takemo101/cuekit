# Design: `cuekit tui` task cockpit

## Background

cuekit's normal CLI output is optimized for agents and scripts. The default TOON output is compact and machine-readable, and `--format json` remains available for strict machine processing. Human operators, however, need a better way to watch running child agents, inspect task details, and take common actions without composing many individual commands.

`cuekit tui` is the human-facing cockpit for that workflow. It is a separate operator surface; it must not replace the TOON-oriented CLI/MCP protocol surface.

## Goals

- Show an interactive task list and selected task details.
- Let users inspect events and transcript tail for the selected task.
- Let users attach to a selected running task's tmux session.
- Let users return to the TUI after detaching from a task, using a safe wrapper/restart flow rather than OpenTUI suspend/resume.
- Let users browse task teams as workflow cockpits: team list, lanes, attention, and member tasks.
- Let users attach to a selected team member task with the same per-task attach behavior.
- Let users run common actions on the selected task: refresh, cancel, delete, steer.
- Reuse existing cuekit command-layer functions and schemas where possible.
- Keep implementation scoped enough for an MVP.

## Non-goals for v1

- New task submission from the TUI.
- Session dashboard / session deletion UI.
- Adapter management UI.
- Complex filtering/search.
- Multi-pane team tmux attach, `join-pane`, nested tmux dashboards, or auto-updating team layouts.
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
- `packages/tui/src/index.tsx` exports `runTui(ctx)`.
- `packages/mcp/src/bin.ts` lazy-imports `@cuekit/tui` only for the `cuekit tui` path.
- Existing MCP/CLI command handlers remain unchanged.

## Layout

### Tasks mode

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

### Teams mode

Add a peer mode for teams, toggled from Tasks mode. The goal is a team cockpit, not a multi-pane tmux dashboard.

```text
┌ Teams ───────────────────────────────┐┌ Team Detail ─────────────────────────┐
│ ● tm_abc  running   feature: skel…  ││ Team: tm_abc                         │
│ ✓ tm_def  completed docs-polish…    ││ Status: running   Tasks: 4 total     │
│ ! tm_xyz  mixed     bugfix timeout  ││ Attention: 1                         │
│                                      ││                                      │
└──────────────────────────────────────┘│ Lanes                                │
                                        │ coordinator ✓ t_1 final report       │
                                        │ worker      ● t_2 implementing       │
                                        │ reviewer    ! t_3 found issue        │
                                        │ finisher    - none                   │
                                        │                                      │
                                        │ Members                              │
                                        │   coordinator t_1 completed          │
                                        │ > worker      t_2 running            │
                                        │   reviewer    t_3 completed          │
                                        └──────────────────────────────────────┘

[t] tasks/teams  [enter] members  [a] attach member  [r] refresh  [q] quit
```

Team list rows should prioritize human scanning:

- aggregate status glyph/color,
- `team_id`,
- title or objective,
- task count summary,
- attention marker/count when `attention_items` or `open_attention` are present.

Team detail should prioritize:

1. title/objective,
2. aggregate status and task counts,
3. lanes grouped by `position` (`coordinator`, `worker`, `reviewer`, `finisher`, `observer`),
4. attention items/manual steer hints,
5. member tasks,
6. latest/final summary and cleanup hint when available.

## Data model

TUI state should derive from command-layer snapshots, not direct ad-hoc SQL where avoidable.

Suggested internal state:

```ts
type TuiMode = "tasks" | "teams";
type TeamFocus = "list" | "members";

type TuiState = {
  mode: TuiMode;
  tasks: TaskSummary[];
  teams: TeamSummary[];
  selectedTaskIndex: number;
  selectedTeamIndex: number;
  selectedMemberIndex: number;
  teamFocus: TeamFocus;
  selectedStatus?: TaskStatusView;
  selectedEvents: TaskEvent[];
  selectedTeamDetail?: TuiTeamDetail;
  transcriptTail: string[];
  loading: boolean;
  message?: string;
  error?: string;
};

type TuiTeamDetail = {
  team_id: string;
  title: string;
  objective?: string;
  status: TeamStatus;
  task_counts: TeamTaskCounts;
  members: TaskSummary[];
  lanes: Record<TeamPosition, TaskSummary[]>;
  attention_items?: TuiTeamAttentionItem[];
  manual_steer_hints?: TuiManualSteerHint[];
  final_summary?: string;
  cleanup_hint?: string;
};
```

Data loading:

- Tasks mode `refresh()` calls `runListTasks(ctx, { limit: 100 })`.
- Teams mode `refresh()` calls `runListTeams(ctx, { limit: 100 })` and loads detail for the selected team.
- For selected task:
  - `runGetTaskStatus(ctx, { task_id })`
  - `runListTaskEvents(ctx, { task_id })`
  - read transcript tail from `result.artifacts` when terminal, or from task artifact path if available through status/result metadata in a later iteration.
- For selected team:
  - `runGetTeamStatus(ctx, { team_id })` for aggregate status, counts, run summary, attention, and member tasks when available.
  - `runGetTeamResult(ctx, { team_id })` only when final summary/timeline detail is needed; avoid making every auto-refresh expensive if status already has enough data.
  - derive `lanes` by grouping member task summaries by `position`, preserving unpositioned members in a separate display row if needed.

For v1, transcript tail can be best-effort:

- show transcript path if known.
- show last N lines when the path exists.
- otherwise show `No transcript available yet`.

## Keyboard actions

Required task-mode keys:

| Key | Action |
| --- | --- |
| `↑` / `k` | select previous task |
| `↓` / `j` | select next task |
| `r` | refresh task list and selected detail |
| `a` | attach to selected task's tmux session, then return to TUI after detach |
| `s` | prompt for steering message and call `runSteerTask` |
| `c` | cancel selected non-terminal task after confirmation |
| `d` | delete selected terminal task after confirmation |
| `t` | toggle to Teams mode |
| `q` / `Esc` | quit |

Required team-mode keys:

| Key | Action |
| --- | --- |
| `↑` / `k` | select previous team, or previous member when member focus is active |
| `↓` / `j` | select next team, or next member when member focus is active |
| `Enter` | move focus from team list to member list |
| `Esc` | move focus from member list back to team list; quit only when already in team-list focus |
| `a` | attach to the selected member task when member focus is active; otherwise show guidance to press `Enter` first |
| `r` | refresh teams and selected team detail |
| `t` | toggle back to Tasks mode |
| `q` | quit |

Optional later keys:

| Key | Action |
| --- | --- |
| `e` | toggle event-focused view |
| `T` | toggle transcript-focused view |
| `?` | show help overlay |

## Attach behavior

Use an attach-and-return wrapper flow. Do **not** implement OpenTUI suspend/resume for this slice; restart the TUI after the tmux attach process exits. This is safer for terminal raw mode and alternate-screen cleanup.

When `a` is pressed in Tasks mode or member-focused Teams mode:

1. Verify the selected task/member has `supports_attach` and a tmux session name or attach hint.
2. Return an attach request to the CLI wrapper with enough state to restore mode/selection.
3. Destroy the OpenTUI renderer cleanly so terminal state is restored.
4. The CLI wrapper executes the tmux attach command with inherited stdio.
5. When the user detaches from tmux, the wrapper starts `runTui()` again with the saved return state and refreshes data.

Conceptual exit contract:

```ts
type TuiExit =
  | { kind: "quit" }
  | {
      kind: "attach";
      args: string[];
      returnState?: {
        mode: "tasks" | "teams";
        selected_task_id?: string;
        selected_team_id?: string;
        selected_member_task_id?: string;
        team_focus?: "list" | "members";
      };
    };
```

Preferred implementation:

- Parse `metadata.tmux_session_name` when available and spawn:

```ts
Bun.spawn(["tmux", "attach-session", "-t", sessionName], { stdio: ["inherit", "inherit", "inherit"] });
```

- If only `attach_hint` is available, avoid shell execution when possible; parse the expected `tmux attach-session -t <name>` shape.
- If attach is unavailable, keep the TUI open and show a footer error.
- MVP restoration can fall back to reselecting the nearest available task/team if the saved id no longer exists.

Team multi-pane attach is explicitly out of scope. Teams mode attaches to one selected member task at a time using the same per-task tmux attach flow.

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

TUI should live in a dedicated package:

```text
packages/tui/
  package.json           # @cuekit/tui; owns OpenTUI/React dependencies
  tsconfig.json
  src/
    index.tsx            # runTui(ctx), attach-and-return wrapper loop
    app.tsx              # top-level state, mode, focus, and keyboard routing
    data.ts              # command-layer data loaders and transcript-tail helper
    attach.ts            # tmux attach args/session-name helpers
    task-actions.ts      # pure action/selection helpers
    tui-state.ts         # optional return-state restore helpers
    components/
      task-list.tsx
      task-detail.tsx
      team-list.tsx
      team-detail.tsx
      footer.tsx
      confirm-dialog.tsx
      input-dialog.tsx
```

Rationale:

- `@cuekit/mcp` should stay focused on MCP + structured CLI command surfaces.
- OpenTUI/React are human-UI dependencies and should not be loaded by the MCP server path.
- A separate `@cuekit/tui` package makes the human operator UI independently testable and keeps future optional installation possible.

`packages/mcp/src/bin.ts` should keep the `cuekit tui` command as the user-facing entrypoint, but lazy-import the TUI only for that path:

```ts
if (isTui) {
  const { runTui } = await import("@cuekit/tui");
  await runTui({ db, registry });
  return;
}
```

The TUI may reuse existing command-layer functions from `@cuekit/mcp` for the MVP, but imports should be explicit package exports rather than deep `src/commands/*` imports where practical. Longer-term, if more frontends need the same command layer, consider extracting a dedicated control package.

## Testing strategy

Unit-test non-rendering pieces first:

- task and team/member selection bounds.
- attach command parsing / session-name extraction.
- attach-and-return exit contract and return-state restoration.
- action enablement rules (`canAttach`, `canCancel`, `canDelete`).
- team list/detail data loader behavior using the in-memory DB and fake tmux runner.
- lane grouping, attention item display, and attachability summaries for team detail.

For OpenTUI rendering itself, start with smoke coverage if feasible:

- `runTui` module imports without throwing.
- command registration recognizes `cuekit tui --help` or equivalent if a help path is added.

Avoid brittle snapshot tests of full terminal output in v1.

## Rollout plan

1. Add OpenTUI references and documentation links. Done.
2. Add `cuekit tui` design note. This document.
3. Spike a read-only TUI with task list, detail pane, refresh, and quit.
4. Add initial per-task tmux attach support.
5. Add cancel/delete/steer actions with confirmation/input prompts.
6. Upgrade per-task attach to the attach-and-return wrapper flow.
7. Add Teams mode with team list/detail, lanes, attention, and member tasks.
8. Add member-task attach from Teams mode using the same attach-and-return flow.
9. Dogfood against real OpenCode and Claude Code tasks and coordinator-led teams.
10. Update README with `cuekit tui` usage.

## Open questions

- Should attach-and-return be the default for `a`, or should one-way attach remain available through a separate key/flag?
  - Recommendation: make attach-and-return the default; `q` still exits the TUI, and a future flag can preserve one-way behavior if needed.
- Should Teams mode load `get_team_result` on every refresh or only on demand?
  - Recommendation: use `get_team_status` for normal refresh and load full result/timeline only on demand or when a team is terminal.
- Should `cuekit tui` default to all tasks or only tasks for the current cwd?
  - Recommendation: default to current cwd for human relevance, with a future `--all` option.
- Should terminal completed tasks remain visible by default?
  - Recommendation: yes for v1, because operators often want recent results.
- How many transcript lines should be shown?
  - Recommendation: last 80 lines, truncated by panel height.
