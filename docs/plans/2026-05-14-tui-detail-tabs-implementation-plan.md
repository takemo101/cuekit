# TUI Detail Tabs Implementation Plan

> **For agentic workers:** REQUIRED: Use cuekit dogfood where useful. Implement each task with TDD, request code review before PR merge, and rebuild `bin/cuekit.js` with `bun run bundle` after source changes.

**Goal:** Reorganize `cuekit tui` detail panes into intent-based tabs so Tasks/Parents/Teams details remain scannable as Swarm-lite context grows.

**Architecture:** Keep existing top-level modes (`tasks`, `parents`, `teams`) and add detail-tab state within the right pane. Implement Team detail tabs first because Teams mode currently has the highest information density, then apply the same tab pattern to Task/Parent detail. Keep team context read-only and preserve existing attach/cancel/delete/cleanup flows.

**Tech Stack:** Bun, TypeScript, React/OpenTUI, existing `@cuekit/tui` components and command-layer TUI context.

---

## File Structure

- `packages/tui/src/tui-state.ts`
  - Add reusable detail-tab types and return-state fields so attach-and-return preserves the active detail tab.
- `packages/tui/src/app.tsx`
  - Own active detail-tab state, keybindings (`[` / `]`, `1`-`5`), mode-aware tab sets, and footer/status hints.
- `packages/tui/src/attach.ts`
  - Thread active task/team detail tab into attach exit return states so attach-and-return restores the same detail view.
- `packages/tui/src/components/team-detail.tsx`
  - Split existing team detail rendering into `Overview`, `Members`, `Attention`, and `Knowledge` tab views.
- `packages/tui/src/components/task-detail.tsx`
  - Later split task/parent detail rendering into `Overview`, `Events`, `Output`, and `Context` tab views.
- `packages/tui/src/components/detail-tabs.tsx` (new)
  - Small shared tab bar/utility component for rendering tab labels and active state.
- `packages/tui/src/data.ts`
  - Keep existing detail data shape; add small derived helpers only if needed for tab counts/overview rows.
- `packages/tui/__tests__/task-detail.test.ts`
  - Rendering tests for task tabs and shared tab behavior.
- `packages/tui/__tests__/tui-data.test.ts`
  - Only update if derived helpers are added.
- `packages/tui/__tests__/tui-actions.test.ts`
  - Tests for tab navigation helpers if implemented outside `App`.
- `packages/tui/__tests__/tui-attach.test.ts`
  - Tests for task/parent/team/member attach return states preserving active detail tabs.
- `packages/tui/__tests__/tui-smoke.test.ts`
  - Source-level smoke assertions for keybindings/footer if necessary.
- `bin/cuekit.js`
  - Rebuilt bundle after source changes.

---

## Issue Breakdown

### Issue 1: Add shared detail-tab state and keybindings

**Purpose:** Introduce the tab framework without rearranging large UI sections yet.

**Files:**
- Modify: `packages/tui/src/tui-state.ts`
- Modify: `packages/tui/src/app.tsx`
- Modify: `packages/tui/src/attach.ts`
- Create: `packages/tui/src/components/detail-tabs.tsx`
- Test: `packages/tui/__tests__/tui-actions.test.ts` or `packages/tui/__tests__/task-detail.test.ts`
- Test: `packages/tui/__tests__/tui-attach.test.ts`
- Bundle: `bin/cuekit.js`

**Acceptance:**
- `[` / `]` switch detail tabs for the active mode.
- `1`-`5` jump to visible tabs when valid and ignore invalid indexes.
- Active tab resets or maps safely when switching top-level modes.
- Attach-and-return preserves active detail tab in `TuiReturnState` for task, parent, team dashboard, and team member attach exits.
- `App` initializes active task/team detail tab state from `props.initialState` on startup, including `parents` mode.
- Existing task/team navigation and actions still work (`a`, `c`, `d`, `s`, `r`, `q`, `t`, `p`, `Enter`, `Esc`, arrows).

#### Steps

- [ ] **Step 1: Write failing tests for tab navigation and mode mapping**

Add small pure helpers if needed, e.g. `nextDetailTab(current, tabs, delta)`, `detailTabByIndex(tabs, index)`, and `safeDetailTabForMode(mode, requestedTab)`.

Tests must cover:

- `[` / `]` previous/next behavior, including wrap or explicit boundary semantics.
- `1`-`5` valid indexes and invalid indexes that leave the active tab unchanged.
- Tasks, Parents, and Teams mode tab sets.
- switching top-level modes maps or resets the active tab safely.
- source/action-helper coverage that existing `a`, `c`, `d`, `s`, `r`, `q`, `t`, `p`, `Enter`, `Esc`, and arrow key behavior remains present.

Run:

```bash
bun test packages/tui/__tests__/tui-actions.test.ts --grep "detail tab"
```

Expected: FAIL because helpers/state do not exist.

- [ ] **Step 2: Write failing attach-return preservation tests**

Update `packages/tui/__tests__/tui-attach.test.ts` with tests for the actual attach builders:

- `buildTuiTaskAttachExit(..., returnMode: "tasks", activeTaskTab)` includes `returnState.task_detail_tab`.
- `buildTuiTaskAttachExit(..., returnMode: "parents", activeTaskTab)` includes `mode: "parents"` and `returnState.task_detail_tab`.
- `buildTuiTeamMemberAttachExit(..., activeTeamTab)` includes `returnState.team_detail_tab` and preserves member focus.
- `buildTuiTeamAttachExit(..., activeTeamTab)` includes `returnState.team_detail_tab`.
- `App` initialized with `initialState.task_detail_tab` starts Tasks/Parents detail on that tab.
- `App` initialized with `initialState.team_detail_tab` starts Teams detail on that tab.

Run:

```bash
bun test packages/tui/__tests__/tui-attach.test.ts --grep "detail tab"
```

Expected: FAIL because attach builders do not accept/pass detail tab values yet.

- [ ] **Step 3: Add detail-tab types**

Add types similar to:

```ts
export type TeamDetailTab = "overview" | "members" | "attention" | "knowledge";
export type TaskDetailTab = "overview" | "events" | "output" | "context";
export type DetailTab = TeamDetailTab | TaskDetailTab;
```

Extend `TuiReturnState` with optional task/team detail tab fields.

- [ ] **Step 4: Implement shared tab bar component**

Create `packages/tui/src/components/detail-tabs.tsx` with a compact renderer:

```tsx
export function DetailTabs(props: { tabs: Array<{ id: string; label: string }>; active: string }) {
  return <text>{props.tabs.map((tab, index) => `${index + 1}${tab.id === props.active ? "●" : ""} ${tab.label}`).join("  ")}</text>;
}
```

Use existing theme colors and keep it one-line.

- [ ] **Step 5: Wire App keybindings, initial state restore, and attach return state**

In `App`, store active tab state for team and task detail. Initialize these states from `props.initialState.task_detail_tab` and `props.initialState.team_detail_tab`, including when `props.initialState.mode === "parents"`. Add keyboard handling for `[` / `]` and numeric keys. Pass the active tab into `buildTuiTaskAttachExit`, `buildTuiTeamAttachExit`, and `buildTuiTeamMemberAttachExit`. Do not change existing `t`, `p`, `a`, `c`, `d`, `s`, `r`, `q`, arrow, or enter behavior.

- [ ] **Step 6: Run validation**

```bash
bun test packages/tui
bun run check
bun run typecheck
bun run bundle
```

Expected: all pass, bundle updated.

- [ ] **Step 7: Request code review and merge PR**

Review focus: keybinding conflicts, attach-and-return state, no action regressions.

---

### Issue 2: Split Team detail into Overview / Members / Attention / Knowledge tabs

**Purpose:** Fix the highest-density UI first by moving current Teams detail sections behind intent-based tabs.

**Files:**
- Modify: `packages/tui/src/components/team-detail.tsx`
- Modify: `packages/tui/src/app.tsx` if tab props are not already passed
- Test: `packages/tui/__tests__/task-detail.test.ts`
- Bundle: `bin/cuekit.js`

**Acceptance:**
- `Overview` shows status, title/objective, task counts, counts for attention/blockers/handoffs/blackboard, and one compact next-action hint when available.
- `Members` shows lanes and member list with selected-member marker.
- `Attention` shows blockers first, then attention items and manual steer hints.
- `Knowledge` shows recent blackboard events and latest handoffs.
- Empty states are compact and do not render multiple noisy empty section headers.
- Team attach/member focus/cleanup/delete behavior remains unchanged.
- No new team mutations, chat/ack/read state, scheduler controls, or automatic actions are introduced; existing manual attach/cancel/delete/cleanup/steer only.

#### Steps

- [ ] **Step 1: Write failing TeamDetail rendering tests**

Cover each tab separately:

```bash
bun test packages/tui/__tests__/task-detail.test.ts --grep "team detail tabs"
```

Expected: FAIL because `TeamDetail` does not accept/render `activeTab` yet.

- [ ] **Step 2: Add `activeTab` prop to `TeamDetail`**

Add `activeTab: TeamDetailTab` with default `overview` for test convenience if appropriate.

- [ ] **Step 3: Extract render sections**

Keep helper functions local unless they grow large:

- `renderTeamOverview`
- `renderTeamMembers`
- `renderTeamAttention`
- `renderTeamKnowledge`

- [ ] **Step 4: Preserve existing member selection semantics**

Ensure `Members` tab is the only tab that needs selected member row highlighting, but member focus/attach still works regardless of tab if current app behavior expects it.

- [ ] **Step 5: Run validation**

```bash
bun test packages/tui/__tests__/task-detail.test.ts --grep "team detail tabs"
bun test packages/tui
bun run check
bun run typecheck
bun run bundle
```

- [ ] **Step 6: Dogfood visually**

Create or reuse a team with blackboard/attention/handoff data and run:

```bash
cuekit tui
```

Verify Teams mode is readable and tab switching works.

- [ ] **Step 7: Request code review and merge PR**

Review focus: no lost data, no noisy empty states, action flows unchanged.

---

### Issue 3: Split Task and Parent detail into Overview / Events / Output / Context tabs

**Purpose:** Apply the same information architecture to task detail and move transcript/live output into a dedicated Output tab.

**Files:**
- Modify: `packages/tui/src/components/task-detail.tsx`
- Modify: `packages/tui/src/app.tsx`
- Test: `packages/tui/__tests__/task-detail.test.ts`
- Bundle: `bin/cuekit.js`

**Acceptance:**
- `Overview` shows status, metadata, summary/result, attach/backend/transcript path metadata.
- `Events` shows recent task events and attention-worthy event highlights.
- `Output` owns the live pane/transcript scrollbox and keeps existing padding/sticky behavior.
- `Context` shows team attention/manual steer hints and related team context when available.
- If `TuiTaskDetail` does not yet carry latest handoffs or blackboard snippets, `Context` should render available team attention/manual steer hints and leave handoff/blackboard snippets explicitly deferred to a later data-loading issue.
- No new task/team mutations, chat/ack/read state, scheduler controls, or automatic actions are introduced; existing manual attach/cancel/delete/cleanup/steer only.
- Parent Sessions mode uses the same task tabs and attach return state.
- Existing transcript filtering/padding tests still pass.

#### Steps

- [ ] **Step 1: Write failing TaskDetail tab rendering tests**

```bash
bun test packages/tui/__tests__/task-detail.test.ts --grep "task detail tabs"
```

Expected: FAIL because task detail is not tabbed.

- [ ] **Step 2: Add `activeTab` prop to `TaskDetail`**

Use `TaskDetailTab` and default to `overview` if needed for existing tests.

- [ ] **Step 3: Move transcript/live output rendering into Output tab**

Do not change `padLinesForLiveOutput`, filtering, or scrollbox behavior except where necessary to render only when Output is active.

- [ ] **Step 4: Move event rendering into Events tab**

Keep recent events compact. Highlight terminal/help/block events without duplicating full transcript content.

- [ ] **Step 5: Move team-related context into Context tab**

Use existing `teamAttentionItems` and `manualSteerHints` from `TuiTaskDetail`. If latest handoffs or blackboard snippets are not yet present on `TuiTaskDetail`, add a compact deferred empty state rather than expanding the data model in this issue.

- [ ] **Step 6: Run validation**

```bash
bun test packages/tui/__tests__/task-detail.test.ts
bun test packages/tui
bun run check
bun run typecheck
bun run bundle
```

- [ ] **Step 7: Request code review and merge PR**

Review focus: transcript usability, parent mode compatibility, no regression in attach/cancel/delete/steer flows.

---

### Issue 4: Polish footer hints and compact help for tabbed details

**Purpose:** Make the new tab UI discoverable without cluttering every detail pane.

**Files:**
- Modify: `packages/tui/src/components/footer.tsx`
- Modify: `packages/tui/src/app.tsx`
- Optional Modify: `packages/tui/src/components/help-dialog.tsx` or create if a small overlay is warranted
- Test: `packages/tui/__tests__/tui-smoke.test.ts`
- Bundle: `bin/cuekit.js`

**Acceptance:**
- Footer shows active mode and available detail tabs compactly.
- Footer includes `[` / `]` and numeric-tab hints only when detail tabs are visible.
- Optional help overlay documents mode-specific actions and tab keys.
- No additional persistent vertical space is consumed in the detail pane.

#### Steps

- [ ] **Step 1: Write failing footer/source smoke tests**

Assert footer or app source includes tab key hints and mode-aware tab labels.

- [ ] **Step 2: Add footer props for tab labels**

Keep footer presentational; App computes active mode/tab text.

- [ ] **Step 3: Optionally add compact help overlay**

Only add if the footer cannot explain the new keys clearly. Keep this read-only.

- [ ] **Step 4: Run validation**

```bash
bun test packages/tui/__tests__/tui-smoke.test.ts
bun test packages/tui
bun run check
bun run typecheck
bun run bundle
```

- [ ] **Step 5: Request code review and merge PR**

Review focus: discoverability, no clutter, no key conflicts.

---

## Cross-Cutting Guardrails

- Do not add chat UX, ack/read state, auto-actions, or scheduler controls.
- Do not change MCP/CLI protocol surfaces for this UI cleanup unless a later issue explicitly requires it.
- Preserve existing attach/cancel/delete/cleanup/steer flows.
- Prefer pure helpers for tab navigation so behavior is easy to test.
- Keep empty states one line per active tab.
- Use TDD for each issue and request code review before merge.

## Final Validation

After all issues are merged:

```bash
bun test packages/tui
bun run check
bun run typecheck
bun run bundle
```

Dogfood:

1. Create a team with completed/running tasks, attention, blackboard events, and handoffs.
2. Run `cuekit tui`.
3. Verify Teams mode tabs are readable.
4. Verify Tasks and Parent Sessions mode tabs are readable.
5. Attach to a task and return to the same mode/tab.
