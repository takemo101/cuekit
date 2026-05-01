# cuekit TUI Task Cockpit Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `cuekit tui`, a human-facing OpenTUI task cockpit for browsing tasks, inspecting details/events/transcripts, attaching to tmux, and running common task actions.

**Architecture:** Keep cuekit's existing TOON/MCP command surface unchanged and add a separate human-only TUI path. The TUI should live in `packages/tui` so OpenTUI/React dependencies and human UI code stay outside the MCP server package; `packages/mcp/src/bin.ts` should lazy-import `@cuekit/tui` only when running `cuekit tui`.

**Tech Stack:** Bun, TypeScript, OpenTUI (`@opentui/core`, `@opentui/react`), React, existing `@cuekit/mcp` command layer, existing `@cuekit/adapters` fake tmux test runner.

---

## References

- Design: [`docs/issues/cuekit-tui-task-cockpit-design.md`](../../issues/cuekit-tui-task-cockpit-design.md)
- OpenTUI references: [`docs/references/opentui/README.md`](../../references/opentui/README.md)
- CLI entrypoint: `packages/mcp/src/bin.ts`
- CLI projection: `packages/mcp/src/cli.ts`
- Command context: `packages/mcp/src/command-context.ts`
- Existing task commands:
  - `packages/mcp/src/commands/list-tasks.ts`
  - `packages/mcp/src/commands/get-task-status.ts`
  - `packages/mcp/src/commands/list-task-events.ts`
  - `packages/mcp/src/commands/cancel-task.ts`
  - `packages/mcp/src/commands/delete-task.ts`
  - `packages/mcp/src/commands/steer-task.ts`

## File Structure

Planned files:

```text
packages/tui/
  package.json           # @cuekit/tui; owns OpenTUI/React dependencies
  tsconfig.json
  src/
    index.tsx            # runTui(ctx), renderer lifecycle, top-level export
    app.tsx              # top-level React state, keyboard routing, layout
    data.ts              # command-layer loaders and transcript-tail helper
    task-actions.ts      # pure action enablement/selection helpers
    attach.ts            # attach_hint parsing and one-way tmux attach helper
    components/
      task-list.tsx      # selected task list panel
      task-detail.tsx    # metadata, events, transcript tail panel
      footer.tsx         # key hints, current message/error
      confirm-dialog.tsx # y/N confirmation overlay
      input-dialog.tsx   # single-line input overlay for steer

packages/mcp/src/bin.ts  # keeps `cuekit tui` entrypoint and lazy-imports @cuekit/tui
```

Planned tests:

```text
packages/tui/__tests__/tui-data.test.ts
packages/tui/__tests__/tui-actions.test.ts
packages/tui/__tests__/tui-attach.test.ts
packages/tui/__tests__/tui-smoke.test.ts
packages/mcp/__tests__/cli.test.ts       # add TUI CLI surface assertions
```

Do not add TUI behavior to `CUEKIT_OPERATIONS`; `cuekit tui` is not an MCP request/response operation. Keep `@opentui/*` and `react` dependencies in `@cuekit/tui`, not in `@cuekit/mcp`.

---

## Chunk 1: OpenTUI dependency and human-only `cuekit tui` entrypoint

### Task 1: Add dependencies and TypeScript JSX support

**Files:**
- Create/Modify: `packages/tui/package.json`
- Modify: `packages/mcp/package.json` only to depend on `@cuekit/tui`
- Modify: `packages/mcp/tsconfig.json` if JSX settings are missing
- Test: `bun run typecheck`

> Historical note: the MVP originally landed under `packages/mcp/src/tui`. The preferred package boundary is now `packages/tui`; refactor existing TUI files there before adding more TUI features.

- [ ] Step 1: Inspect OpenTUI reference docs

Read:

```sh
sed -n '1,180p' docs/references/opentui/01-getting-started.md
sed -n '1,220p' docs/references/opentui/13-bindings-react.md
```

- [ ] Step 2: Add runtime dependencies

Add dependencies to `packages/tui/package.json`:

```json
{
  "dependencies": {
    "@opentui/core": "<current-compatible-version>",
    "@opentui/react": "<current-compatible-version>",
    "react": "<current-compatible-version>"
  },
  "devDependencies": {
    "@types/react": "<current-compatible-version>"
  }
}
```

Use `cd packages/tui && bun add ...` or an equivalent workspace-aware command. `@cuekit/mcp` should depend on `@cuekit/tui` but should not own OpenTUI/React dependencies directly.

- [ ] Step 3: Configure JSX for OpenTUI React

Ensure `packages/tui/tsconfig.json` supports:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@opentui/react"
  }
}
```

Keep inherited project compiler settings intact.

- [ ] Step 4: Run typecheck

Run:

```sh
bun run typecheck
```

Expected: all packages typecheck.

### Task 2: Add a minimal `runTui` module and route `cuekit tui`

**Files:**
- Create/Move: `packages/tui/src/index.tsx`
- Modify: `packages/mcp/src/bin.ts`
- Modify: `packages/mcp/__tests__/cli.test.ts`

- [ ] Step 1: Add failing CLI integration test

Add a test that invokes:

```sh
bun packages/mcp/src/bin.ts tui --help
```

Expected behavior for v1: exit code `0`, stdout contains `cuekit tui`, stderr empty.

Also assert `CUEKIT_OPERATIONS` does not contain `tui` and no MCP tool named `tui` exists.

- [ ] Step 2: Implement minimal TUI help intercept

In `bin.ts`, before `cli.serve()`, detect:

```ts
const isTui = process.argv[2] === "tui";
```

For `cuekit tui --help`, print concise help without starting OpenTUI:

```text
cuekit tui — interactive task cockpit

Usage: cuekit tui

Keys: ↑/↓ select, r refresh, a attach, s steer, c cancel, d delete, q quit
```

For plain `cuekit tui`, call `runTui({ db, registry })`.

- [ ] Step 3: Create minimal `runTui`

`packages/tui/src/index.tsx` should export:

```ts
import type { CommandContext } from "../command-context.ts";

export async function runTui(_ctx: CommandContext): Promise<void> {
  // Temporary placeholder until Chunk 3.
  process.stdout.write("cuekit tui is not implemented yet\n");
}
```

This keeps routing testable before rendering is built.

- [ ] Step 4: Run tests

Run:

```sh
bun test packages/mcp/__tests__/cli.test.ts
bun run typecheck
```

Expected: new test passes; typecheck passes.

- [ ] Step 5: Commit

Use GitButler only:

```sh
but status -fv
but commit <branch> -m "feat(tui): add cuekit tui entrypoint" --changes <ids> --status-after
```

---

## Chunk 2: TUI data and pure action helpers

### Task 3: Implement data loader helpers

**Files:**
- Create: `packages/tui/src/data.ts`
- Test: `packages/tui/__tests__/tui-data.test.ts`

- [ ] Step 1: Write failing data tests

Test with in-memory DB and fake tmux runner:

- empty task list returns empty `tasks` and no selected detail.
- submitted task appears in TUI list.
- selected detail loads status and task events.
- transcript tail helper returns last N lines from an existing file.
- missing transcript returns an empty tail and no throw.

- [ ] Step 2: Implement `loadTaskList`

Suggested API:

```ts
export async function loadTaskList(ctx: CommandContext, options?: { cwd?: string; limit?: number }) {
  return runListTasks(ctx, { cwd: options?.cwd, limit: options?.limit ?? 100 });
}
```

Default to current cwd if that is the chosen v1 behavior. If implementing current-cwd default, make it explicit and covered by tests.

- [ ] Step 3: Implement `loadTaskDetail`

Suggested API:

```ts
export async function loadTaskDetail(ctx: CommandContext, taskId: string) {
  const status = await runGetTaskStatus(ctx, { task_id: taskId });
  const events = await runListTaskEvents(ctx, { task_id: taskId });
  return { status, events: "events" in events ? events.events : [] };
}
```

Adapt to actual output unions.

- [ ] Step 4: Implement transcript tail helper

```ts
export function readTranscriptTail(path: string | undefined, maxLines = 80): string[] {
  if (!path) return [];
  // return last maxLines lines; ignore missing file errors.
}
```

- [ ] Step 5: Run targeted tests

```sh
bun test packages/tui/__tests__/tui-data.test.ts
bun run typecheck
```

### Task 4: Implement pure selection/action helpers

**Files:**
- Create: `packages/tui/src/task-actions.ts`
- Test: `packages/tui/__tests__/tui-actions.test.ts`

- [ ] Step 1: Write failing tests

Cover:

- `moveSelection(index, delta, length)` clamps to bounds.
- `canAttach(statusView)` requires `supports_attach` and `attach_hint` or `metadata.tmux_session_name`.
- `canCancel(status)` false for terminal states.
- `canDelete(status)` true only for terminal states.

- [ ] Step 2: Implement helpers

Keep this file pure and independent of OpenTUI.

- [ ] Step 3: Run tests

```sh
bun test packages/tui/__tests__/tui-actions.test.ts
```

- [ ] Step 4: Commit

```sh
but status -fv
but commit <branch> -m "feat(tui): add task data and action helpers" --changes <ids> --status-after
```

---

## Chunk 3: Read-only OpenTUI dashboard

### Task 5: Render task list, detail, footer, refresh, quit

**Files:**
- Create: `packages/tui/src/app.tsx`
- Create: `packages/tui/src/components/task-list.tsx`
- Create: `packages/tui/src/components/task-detail.tsx`
- Create: `packages/tui/src/components/footer.tsx`
- Modify: `packages/tui/src/index.tsx`
- Test: `packages/tui/__tests__/tui-actions.test.ts` or a small import smoke test

- [ ] Step 1: Replace placeholder `runTui` with OpenTUI renderer

Use OpenTUI React:

```ts
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

export async function runTui(ctx: CommandContext): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  createRoot(renderer).render(<App ctx={ctx} />);
}
```

Ensure renderer destruction on quit is handled inside `App` or through an injected callback.

- [ ] Step 2: Implement layout components

Use JSX elements from `@opentui/react`:

- `<box>` for panes and footer.
- `<text>` for task rows and detail fields.
- `<scrollbox>` for events/transcript if needed.

- [ ] Step 3: Implement keyboard navigation

Use `useKeyboard`:

- `up` / `k`: previous task.
- `down` / `j`: next task.
- `r`: refresh.
- `q` / `escape`: destroy renderer and exit.

- [ ] Step 4: Implement manual refresh

On mount and on `r`, call data loaders. Keep loading/error/footer message state in `App`.

- [ ] Step 5: Smoke test module import

Add a minimal test that imports `runTui` and pure components/helpers without starting the renderer. Avoid brittle full terminal snapshots.

- [ ] Step 6: Manual test

Run:

```sh
bun packages/mcp/src/bin.ts tui
```

Expected:

- TUI opens.
- Task list appears.
- `↑/↓` or `j/k` changes selection.
- `r` refreshes.
- `q` exits cleanly and restores terminal.

- [ ] Step 7: Commit

```sh
but status -fv
but commit <branch> -m "feat(tui): render read-only task dashboard" --changes <ids> --status-after
```

---

## Chunk 4: One-way tmux attach

### Task 6: Implement safe attach command extraction and execution

**Files:**
- Create: `packages/tui/src/attach.ts`
- Modify: `packages/tui/src/app.tsx`
- Test: `packages/tui/__tests__/tui-attach.test.ts`

- [ ] Step 1: Write failing attach tests

Cover:

- extracts `metadata.tmux_session_name` when present.
- parses `tmux attach-session -t cuekit-task-t_abc` attach hints.
- rejects non-tmux or malformed attach hints.
- builds argv `['tmux', 'attach-session', '-t', sessionName]`.

- [ ] Step 2: Implement extraction helpers

Suggested API:

```ts
export function getTmuxSessionName(status: TaskStatusView): string | null;
export function buildTmuxAttachArgs(sessionName: string): string[];
```

Avoid shell execution.

- [ ] Step 3: Implement one-way attach action

When `a` is pressed:

1. Extract session name.
2. If unavailable, show footer error.
3. Destroy renderer.
4. Spawn tmux attach with inherited stdio.
5. Await process exit or let it own the terminal; do not restart TUI.

- [ ] Step 4: Manual test with a real running task

Create a long-running cuekit task, run `cuekit tui`, select it, press `a`.

Expected:

- TUI exits.
- tmux attach opens the selected task session.
- Detaching from tmux returns to shell, not TUI.

- [ ] Step 5: Commit

```sh
but status -fv
but commit <branch> -m "feat(tui): attach selected task tmux session" --changes <ids> --status-after
```

---

## Chunk 5: Mutating task actions

### Task 7: Add cancel/delete confirmation dialogs

**Files:**
- Create: `packages/tui/src/components/confirm-dialog.tsx`
- Modify: `packages/tui/src/app.tsx`
- Modify: `packages/tui/src/task-actions.ts`
- Test: `packages/tui/__tests__/tui-actions.test.ts`

- [ ] Step 1: Add action enablement tests

Ensure:

- cancel is unavailable for terminal tasks.
- delete is unavailable for non-terminal tasks.
- delete is available for completed/failed/cancelled/timed_out/blocked.

- [ ] Step 2: Implement confirm dialog state

State shape example:

```ts
type PendingConfirm =
  | { kind: "cancel"; taskId: string }
  | { kind: "delete"; taskId: string }
  | null;
```

- [ ] Step 3: Wire keys

- `c`: if cancellable, show confirm.
- `d`: if deletable, show confirm.
- `y`: execute pending action.
- `n` / `escape`: cancel dialog.

- [ ] Step 4: Execute through command-layer functions

- cancel: `runCancelTask(ctx, { task_id })`
- delete: `runDeleteTask(ctx, { task_id })`

Refresh after success. Show structured error message on failure.

- [ ] Step 5: Manual test

Use fake or real tasks:

- cancel a running task.
- delete a terminal task.
- verify task list refreshes.

### Task 8: Add steer input dialog

**Files:**
- Create: `packages/tui/src/components/input-dialog.tsx`
- Modify: `packages/tui/src/app.tsx`
- Test: optional pure state tests, manual interactive test required

- [ ] Step 1: Implement input dialog

Use OpenTUI input component/reference:

- show prompt: `Steer task <id>:`
- empty submit cancels.
- escape cancels.

- [ ] Step 2: Execute steering through command layer

Call:

```ts
runSteerTask(ctx, { task_id: selectedTaskId, message })
```

Refresh and show footer success/error.

- [ ] Step 3: Manual test

Start a running task, open `cuekit tui`, select task, press `s`, send a short steering message.

Expected:

- command returns ok.
- task receives message in tmux pane.

- [ ] Step 4: Commit

```sh
but status -fv
but commit <branch> -m "feat(tui): add cancel delete and steer actions" --changes <ids> --status-after
```

---

## Chunk 6: Documentation, validation, and dogfood

### Task 9: Document `cuekit tui`

**Files:**
- Modify: `README.md`
- Modify: `docs/issues/cuekit-tui-task-cockpit-design.md` if implementation diverged

- [ ] Step 1: Add README section

Document:

```sh
cuekit tui
```

Include keys:

```text
↑/↓ or j/k select
r refresh
a attach and exit
s steer
c cancel
d delete
q quit
```

- [ ] Step 2: Mention TOON stays default for normal CLI

Clarify TUI is a human operator surface and does not replace agent-oriented output.

### Task 10: Full validation and dogfood

**Files:**
- No required source changes unless validation finds bugs.

- [ ] Step 1: Run validation

```sh
bun run typecheck
bun run test
bun run check
```

Expected:

- typecheck passes.
- tests pass.
- `bun run check` may still report existing Biome schema-version info / broken `.claude` symlink warnings if not addressed separately.

- [ ] Step 2: Dogfood with real tasks

Submit one OpenCode task and one Claude Code task, then run `cuekit tui`.

Verify:

- both tasks appear.
- detail panel updates.
- events are visible.
- transcript tail is visible when available.
- attach works for a running task and exits TUI.
- cancel/delete/steer work as expected.

- [ ] Step 3: Request code review

Use a code-review subagent or project review flow. Provide:

- design doc path.
- plan path.
- changed files.
- validation results.
- manual dogfood notes.

- [ ] Step 4: Address review feedback

Repeat validation after fixes.

- [ ] Step 5: Create PR and merge

Use GitButler for branch/commit/push. Use `gh pr create` / `gh pr merge` for PR operations as project workflow allows.

- [ ] Step 6: Final cleanup

Delete dogfood sessions/tasks if no longer needed. Confirm no `cuekit-task-*` tmux sessions are leaked.

---

## GitHub Issue Breakdown

1. [#93 Add OpenTUI dependency and cuekit tui entrypoint](https://github.com/takemo101/cuekit/issues/93)
2. [#94 Add TUI data loaders and task action helpers](https://github.com/takemo101/cuekit/issues/94)
3. [#95 Build read-only OpenTUI task dashboard](https://github.com/takemo101/cuekit/issues/95)
4. [#96 Add one-way tmux attach to cuekit tui](https://github.com/takemo101/cuekit/issues/96)
5. [#97 Add cancel delete and steer actions to cuekit tui](https://github.com/takemo101/cuekit/issues/97)
6. [#98 Document validate and dogfood cuekit tui MVP](https://github.com/takemo101/cuekit/issues/98)
