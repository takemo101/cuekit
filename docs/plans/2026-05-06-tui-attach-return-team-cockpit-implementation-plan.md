# TUI Attach-and-Return Team Cockpit Implementation Plan

> **For agentic workers:** REQUIRED: Use cuekit team strategies for non-trivial cuekit repo work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cuekit tui` more useful for long-running agent work by returning to the TUI after task attach, adding a Teams mode cockpit, and allowing normal per-task attach from selected team members.

**Architecture:** Keep tmux attach per-task only. Avoid multi-pane team attach, `join-pane`, nested tmux dashboards, and OpenTUI suspend/resume. Implement attach-and-return as a CLI wrapper loop: the React/OpenTUI app exits with an attach request, the CLI runs `tmux attach-session`, then restarts the TUI with saved state. Add Teams mode on top of existing command-layer snapshots (`listTeams`, `getTeamStatus`, `listTasks`) and render lanes/attention/member tasks as a human cockpit.

**Tech Stack:** TypeScript, React/OpenTUI, Bun tests, existing `@cuekit/tui` package, existing MCP command-layer context wrappers, tmux attach helpers.

---

## Issue Breakdown

1. **Issue 1 — Add attach-and-return wrapper for task attach**
   - Scope: TUI exit contract, wrapper loop, return-state restoration for existing task mode.
   - Output: pressing `a` attaches to a task, detach returns to refreshed TUI.

2. **Issue 2 — Add team list/detail data loaders**
   - Scope: TUI context types and data helpers for listing teams, loading team status/result, grouping members by lane.
   - Output: tested non-rendering data model for Teams mode.

3. **Issue 3 — Add Teams mode UI and keyboard navigation**
   - Scope: app mode state, team list/detail components, team/member focus navigation.
   - Output: `t` toggles Tasks/Teams, team detail shows lanes/attention/members.

4. **Issue 4 — Add member-task attach from Teams mode**
   - Scope: use attach-and-return from selected member task, restore Teams mode/team/member selection after detach.
   - Output: member-focused `a` behaves like normal task attach.

5. **Issue 5 — Dogfood, docs, and validation**
   - Scope: full test run, manual/TUI dogfood where feasible, README/docs alignment if needed.
   - Output: final evidence and any UX follow-up notes.

---

## Chunk 1: Attach-and-Return Wrapper

### Task 1: Add a TUI exit contract and wrapper loop for existing task attach

**Files:**
- Modify: `packages/tui/src/index.tsx`
- Modify: `packages/tui/src/app.tsx`
- Modify: `packages/tui/src/attach.ts`
- Create: `packages/tui/src/tui-state.ts`
- Modify/Test: `packages/tui/__tests__/tui-actions.test.ts`
- Modify/Test: `packages/tui/__tests__/tui-attach.test.ts` if present, otherwise create it.

- [ ] **Step 1: Write tests for return-state helpers**

Create `packages/tui/src/tui-state.ts` tests in `packages/tui/__tests__/tui-actions.test.ts` or a new `tui-state.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { restoreIndexById } from "../src/tui-state.ts";

describe("tui return state helpers", () => {
  it("restores selection by id and falls back to the nearest valid index", () => {
    expect(restoreIndexById([{ id: "a" }, { id: "b" }], "b", 0, (x) => x.id)).toBe(1);
    expect(restoreIndexById([{ id: "a" }], "missing", 5, (x) => x.id)).toBe(0);
    expect(restoreIndexById([], "missing", 5, (x) => x.id)).toBe(0);
  });
});
```

- [ ] **Step 2: Define exit/return-state types**

In `packages/tui/src/tui-state.ts`:

```ts
export type TuiMode = "tasks" | "teams";
export type TeamFocus = "list" | "members";

export type TuiReturnState = {
  mode?: TuiMode;
  selected_task_id?: string;
  selected_team_id?: string;
  selected_member_task_id?: string;
  team_focus?: TeamFocus;
};

export type TuiExit =
  | { kind: "quit" }
  | { kind: "attach"; args: string[]; returnState?: TuiReturnState };

export function restoreIndexById<T>(
  items: T[],
  id: string | undefined,
  fallbackIndex: number,
  getId: (item: T) => string,
): number {
  if (items.length <= 0) return 0;
  if (id) {
    const found = items.findIndex((item) => getId(item) === id);
    if (found >= 0) return found;
  }
  return Math.max(0, Math.min(items.length - 1, fallbackIndex));
}
```

- [ ] **Step 3: Change `runTui` to return a `TuiExit`**

In `packages/tui/src/index.tsx`, adjust the current `runTui(ctx)` API to resolve with `{ kind: "quit" }` or an attach request. If the current implementation accepts `onAttach`, replace the callback with a promise resolver. Keep the public `runTui` function small.

Expected shape:

```ts
export async function runTui(ctx: TuiContext, initialState?: TuiReturnState): Promise<TuiExit> {
  return new Promise((resolve) => {
    render(<App ctx={ctx} initialState={initialState} onExit={resolve} />);
  });
}
```

Adjust exact OpenTUI render call to match existing code.

- [ ] **Step 4: Update `App` attach/quit paths**

In `packages/tui/src/app.tsx`:

- replace `onAttach?: (args: string[]) => void` with `onExit: (exit: TuiExit) => void`,
- on `q`/quit, call `onExit({ kind: "quit" })` before/after renderer destroy,
- on task attach, build return state:

```ts
onExit({
  kind: "attach",
  args: buildTmuxAttachArgs(sessionName),
  returnState: { mode: "tasks", selected_task_id: detail.status.task_id },
});
renderer.destroy();
```

Keep existing attach availability checks.

- [ ] **Step 5: Add wrapper loop around tmux attach**

In `packages/tui/src/index.tsx` or an exported `runTuiLoop(ctx)`:

```ts
export async function runTuiLoop(ctx: TuiContext): Promise<void> {
  let state: TuiReturnState | undefined;
  while (true) {
    const exit = await runTui(ctx, state);
    if (exit.kind === "quit") return;
    state = exit.returnState;
    const code = await runAttachArgs(exit.args);
    if (code !== 0) {
      state = { ...state /* future message can be added later */ };
    }
  }
}
```

Prefer reusing `runTmuxAttach(sessionName)` if the code can pass session names instead of arbitrary args. Avoid shell execution.

- [ ] **Step 6: Wire the MCP bin path to the loop**

In `packages/mcp/src/bin.ts`, call the loop entrypoint for `cuekit tui`. Keep lazy import behavior and MCP package boundary tests passing.

- [ ] **Step 7: Run targeted tests**

Run:

```bash
bun test packages/tui/__tests__/tui-actions.test.ts packages/tui/__tests__/tui-attach.test.ts packages/mcp/__tests__/tui-package-boundary.test.ts
bun run typecheck
```

Expected: PASS.

---

## Chunk 2: Team Data Model and Loaders

### Task 2: Add team list/detail types and loaders

**Files:**
- Modify: `packages/tui/src/context.ts`
- Modify: `packages/mcp/src/tui-context.ts`
- Modify: `packages/tui/src/data.ts`
- Modify/Test: `packages/tui/__tests__/tui-data.test.ts`
- Read: `packages/mcp/src/commands/get-team-status.ts`
- Read: `packages/mcp/src/commands/list-teams.ts`

- [ ] **Step 1: Extend TUI context types**

In `packages/tui/src/context.ts`, add minimal structural types for teams:

```ts
export type TuiTeamSummary = {
  team_id: string;
  session_id: string;
  title: string;
  objective?: string;
  status?: string;
  updated_at?: string;
};

export type TuiTeamListOutput =
  | { teams: TuiTeamSummary[]; has_more?: boolean; next_cursor?: string }
  | { error: JobError };

export type TuiTeamStatusOutput =
  | {
      team_id: string;
      session_id?: string;
      title?: string;
      objective?: string;
      status?: string;
      task_counts?: unknown;
      tasks?: TaskSummary[];
      run_summary?: {
        attention_items?: TuiTeamAttentionItem[];
        manual_steer_hints?: TuiManualSteerHint[];
        open_attention?: Array<{ task_id: string; position?: string; status: string; message?: string }>;
      };
      cleanup_hint?: string;
    }
  | { error: JobError };
```

Match actual command output names from existing schemas; do not overfit to unavailable fields.

- [ ] **Step 2: Expose listTeams/getTeamStatus in MCP TUI context**

In `packages/mcp/src/tui-context.ts`:

- import `runListTeams`,
- add `listTeams(input)` with the same project scoping behavior as `listTasks`,
- keep existing `getTeamStatus`.

- [ ] **Step 3: Add data helpers**

In `packages/tui/src/data.ts` add:

```ts
export async function loadTeamList(ctx: TuiContext, options = {}): Promise<TuiTeamListOutput> {
  return ctx.listTeams ? ctx.listTeams({ ...options, limit: options.limit ?? 100 }) : { teams: [] };
}

export type TuiTeamDetail = {
  team: TuiTeamSummary;
  status?: TuiTeamStatusOutput extends infer T ? T : never;
  members: TaskSummary[];
  lanes: Partial<Record<string, TaskSummary[]>>;
  attentionItems?: TuiTeamAttentionItem[];
  manualSteerHints?: TuiManualSteerHint[];
  error?: string;
};

export async function loadTeamDetail(ctx: TuiContext, team: TuiTeamSummary): Promise<TuiTeamDetail> { ... }
```

Implementation guidance:

- call `ctx.getTeamStatus(team.team_id)` when available,
- use member tasks from status output if present; otherwise call `ctx.listTasks({ team_id })`,
- group members by `position ?? "unpositioned"`,
- pass through attention and manual steer hints from `run_summary`.

- [ ] **Step 4: Write tests for team loader**

In `packages/tui/__tests__/tui-data.test.ts` add tests:

- empty team list loads,
- team detail groups `coordinator`, `worker`, `reviewer`, `finisher`, and `unpositioned`,
- attention items are passed through,
- if `getTeamStatus` returns error, detail preserves team summary and exposes error,
- fallback to `listTasks({ team_id })` works when status has no member list.

- [ ] **Step 5: Run tests**

Run:

```bash
bun test packages/tui/__tests__/tui-data.test.ts packages/mcp/__tests__/tui-context.test.ts
bun run typecheck
```

Expected: PASS.

---

## Chunk 3: Teams Mode UI

### Task 3: Add Teams mode list/detail rendering and navigation

**Files:**
- Modify: `packages/tui/src/app.tsx`
- Create: `packages/tui/src/components/team-list.tsx`
- Create: `packages/tui/src/components/team-detail.tsx`
- Modify: `packages/tui/src/components/footer.tsx`
- Modify/Test: `packages/tui/__tests__/tui-actions.test.ts`
- Create/Test: `packages/tui/__tests__/team-detail.test.ts` if needed.

- [ ] **Step 1: Add pure selection helpers for teams/members**

In `packages/tui/src/task-actions.ts` or a new `team-actions.ts`, add helpers for mode/focus-safe selection. Tests should cover:

- team selection clamps,
- member selection clamps,
- switching teams resets member index to a valid member,
- `Enter` moves focus to members only when members exist,
- `Esc` returns focus from members to team list.

- [ ] **Step 2: Implement `TeamList` component**

Create `packages/tui/src/components/team-list.tsx`:

Display rows with:

- selection marker,
- status glyph/color,
- team id,
- title/objective truncated,
- task count/attention count if available from summary/detail.

Keep it simple and similar to `TaskList` style.

- [ ] **Step 3: Implement `TeamDetail` component**

Create `packages/tui/src/components/team-detail.tsx`:

Sections:

1. team title/objective/status/counts,
2. lanes grouped by position,
3. attention items/manual steer hints,
4. member task list with selected member marker when focused,
5. footer/help text for `Enter`, `Esc`, and `a`.

Do not render raw full timeline in the MVP.

- [ ] **Step 4: Add mode state to `App`**

In `packages/tui/src/app.tsx`:

- add `mode: "tasks" | "teams"`,
- add `teams`, `selectedTeamIndex`, `selectedMemberIndex`, `teamFocus`, `teamDetail`,
- load tasks in Tasks mode and teams/team detail in Teams mode,
- `t` toggles mode,
- `j/k` route to task/team/member selection based on mode/focus,
- `Enter` and `Esc` route team focus.

Keep existing task-mode behavior unchanged.

- [ ] **Step 5: Update footer**

Footer should show mode-aware keys:

- Tasks: `t teams`, `a attach`, `s steer`, `c cancel`, `d delete`.
- Teams list focus: `t tasks`, `enter members`, `r refresh`, `q quit`.
- Teams member focus: `a attach member`, `esc team list`, `j/k member`.

- [ ] **Step 6: Render/smoke tests**

Add tests for pure `TeamDetail` helpers if the component exposes them, and keep existing smoke tests passing:

```bash
bun test packages/tui/__tests__/tui-smoke.test.ts packages/tui/__tests__/tui-actions.test.ts packages/tui/__tests__/task-detail.test.ts packages/tui/__tests__/team-detail.test.ts
```

Expected: PASS.

---

## Chunk 4: Member Attach with Return State

### Task 4: Attach selected team member with the normal per-task attach flow

**Files:**
- Modify: `packages/tui/src/app.tsx`
- Modify: `packages/tui/src/data.ts` if member status lookup is needed
- Modify/Test: `packages/tui/__tests__/tui-actions.test.ts`
- Modify/Test: `packages/tui/__tests__/tui-attach.test.ts`

- [ ] **Step 1: Add attachability resolution for members**

Team detail members are `TaskSummary`, but attach needs `TaskStatusView`. Implement a helper path:

- when member-focused `a` is pressed, call `loadTaskDetail(ctx, member.task_id)` or `ctx.getTaskStatus(member.task_id)`,
- reuse `canAttach()` and `getTmuxSessionName()`.

- [ ] **Step 2: Return attach request with Teams mode state**

When attach is available:

```ts
onExit({
  kind: "attach",
  args: buildTmuxAttachArgs(sessionName),
  returnState: {
    mode: "teams",
    selected_team_id: selectedTeam.team_id,
    selected_member_task_id: member.task_id,
    team_focus: "members",
  },
});
```

- [ ] **Step 3: Restore Teams mode after detach**

Use `initialState` in `App` to:

- start in Teams mode,
- select the saved team if still present,
- select the saved member if still present,
- keep focus on members when possible.

Fallbacks:

- missing team -> first team,
- missing member -> first member,
- no members -> team list focus.

- [ ] **Step 4: Add tests**

Test pure restoration helpers and attach request construction where possible. If app-level keyboard tests are too brittle, isolate helpers.

Cases:

- member attach returns Teams mode state,
- missing member fallback works,
- attach unavailable member shows error and stays in TUI.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
bun test packages/tui/__tests__/tui-actions.test.ts packages/tui/__tests__/tui-attach.test.ts packages/tui/__tests__/tui-data.test.ts
bun run typecheck
```

Expected: PASS.

---

## Chunk 5: Dogfood and Final Validation

### Task 5: Validate UX behavior and update docs if needed

**Files:**
- Potentially modify: `docs/designs/cuekit-tui-task-cockpit-design.md`
- Potentially modify: `README.md` or a guide only if existing docs mention old one-way behavior.

- [ ] **Step 1: Full validation**

Run:

```bash
bun run fix
bun run check
bun run typecheck
bun test
```

Expected: all pass.

- [ ] **Step 2: Manual dogfood attach-and-return**

Start or use an existing attachable task, run:

```bash
cuekit tui
```

Verify:

- `a` attaches to task,
- detaching from tmux returns to TUI,
- task list refreshes,
- no terminal raw-mode corruption is visible.

- [ ] **Step 3: Manual dogfood Teams mode**

Use an existing team with coordinator/worker/reviewer tasks. Verify:

- `t` toggles Teams mode,
- team list displays status/title/attention,
- `Enter` focuses members,
- member `a` attaches to the selected task,
- detach returns to Teams mode with the same team/member selected when still present.

- [ ] **Step 4: Capture follow-ups**

If dogfood reveals layout or tmux-edge issues, either fix small issues or open follow-up issues. Do not add multi-pane team attach in this work.

- [ ] **Step 5: Final report**

Final report should include:

- files changed,
- tests run,
- dogfood evidence,
- known limitations,
- explicit confirmation that multi-pane team attach was not implemented.

---

## Acceptance Criteria

- Pressing `a` on an attachable task attaches to tmux and returns to `cuekit tui` after detach.
- TUI can restore the previously selected task after attach when it still exists.
- TUI has a Teams mode reachable from task mode.
- Teams mode shows team list and selected team detail.
- Team detail shows lanes, attention/manual steer hints, and member tasks.
- Member-focused `a` attaches to the selected member task using the same per-task attach flow.
- Detaching from member attach returns to Teams mode and restores team/member selection when possible.
- No team multi-pane attach, `join-pane`, nested tmux dashboards, auto-layout updates, scheduler, or auto-routing is added.
- Existing cancel/delete/steer task actions continue to work.
- Full validation passes.

## Non-Goals

- Multi-pane team tmux attach.
- Tmux `join-pane` or dashboard session management.
- OpenTUI suspend/resume.
- TUI team creation/submission/wait actions.
- Complex filtering/search.
- Automatic team task scheduling or auto-routing.
