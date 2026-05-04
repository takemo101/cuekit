# MCP Team Dogfood Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the grouped MCP Task Teams dogfood findings into small, independently implementable improvements for AI callers.

**Architecture:** Keep the grouped MCP surface (`get_status`, `wait`, `list`, `cleanup`, `delete`) unchanged. Improve the command handlers and docs that sit behind it: team task submission should better inherit defaults, waits should be documented for bounded polling, terminal child reports should be easier for parents to consume, and validation errors should include paths.

**Tech Stack:** TypeScript, Bun, Zod/incur schemas, SQLite store, cuekit command handlers, GitHub Issues.

---

## Context from dogfood run

Dogfood team: `tm_33748e1f9a18`

Findings:

1. First `submit_team_tasks` attempt was rejected with `Invalid input: expected string, received undefined` when the task item omitted explicit adapter/model fields. The team config and project submit defaults should make this easier for AI callers.
2. A long `wait({ timeout_ms: 600000 })` exceeded the MCP request timeout. Short bounded polling worked.
3. Reviewer task entered a stop-hook/idle prompt state. `get_status` surfaced `attention_hint`, and `steer_task` successfully nudged it to report completion.
4. Terminal child report messages were present in `task_events`, but `get_task_result` returned an empty `summary`, so parent agents must inspect events to see the useful final message.

## File map

- `packages/mcp/src/commands/submit-team-tasks.ts` — applies team role defaults and submits each task.
- `packages/mcp/src/commands/submit-task.ts` — applies project `submit` defaults and resolves Agent Profiles.
- `packages/project-config/src/apply.ts` — shared project/team default helpers.
- `packages/mcp/src/commands/wait-tasks.ts` and `packages/mcp/src/commands/wait-team.ts` — wait behavior and output.
- `packages/mcp/src/operations.ts` — grouped MCP schema descriptions for AI tools.
- `packages/mcp/src/commands/get-task-result.ts` — normalized task result collection.
- `packages/mcp/src/commands/report-task-event.ts` — child terminal reporting path.
- `packages/mcp/__tests__/commands.test.ts` — command-level tests.
- `packages/mcp/__tests__/mcp-stdio-integ.test.ts` — MCP wire tests.
- `docs/guides/project-config.md`, `README.md`, `docs/decisions/002-grouped-mcp-surface.md` — docs.

---

## Chunk 1: Team submission defaults and clearer validation

### Task 1: Make `submit_team_tasks` friendlier when task items rely on defaults

**Files:**
- Modify: `packages/mcp/src/commands/submit-team-tasks.ts`
- Modify: `packages/mcp/__tests__/commands.test.ts`
- Possibly modify: `packages/project-config/src/apply.ts`

- [ ] **Step 1: Write a failing test**

Add a `submit-team-tasks` test that creates a `.cuekit.yaml` with:

```yaml
submit:
  agent: claude-code
  model: sonnet
teams:
  roles:
    coordinator: planner
    worker: worker
```

Call `runSubmitTeamTasks` with an item that has only:

```ts
{
  position: "coordinator",
  objective: "Plan the refactor",
  cwd: root,
}
```

Expected result:

```ts
expect(result.accepted).toHaveLength(1);
expect(result.accepted[0]).toMatchObject({
  agent_kind: "claude-code",
  role: "planner",
  position: "coordinator",
  model: "sonnet",
});
expect(result.rejected).toEqual([]);
```

Run:

```sh
bun test packages/mcp/__tests__/commands.test.ts --grep "submit-team-tasks"
```

Expected: FAIL before implementation if defaults are not applied deeply enough.

- [ ] **Step 2: Implement minimal change**

In `runSubmitTeamTasks`, keep item parsing strict, but ensure the effective task handed to `runSubmitTask` includes:

- role from `teams.roles[position]` when item role is omitted
- safe adapter options when role came from team config and caller did not supply adapter options
- no requirement that each team item repeat `agent_kind`/`model`; `runSubmitTask` should continue to fill those from project submit defaults or the selected Agent Profile

If the existing code already does most of this, fix the missing edge case exposed by the test instead of broad refactoring.

- [ ] **Step 3: Verify**

Run:

```sh
bun test packages/mcp/__tests__/commands.test.ts --grep "submit-team-tasks"
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```sh
but stage packages/mcp/src/commands/submit-team-tasks.ts packages/mcp/__tests__/commands.test.ts <branch>
but commit <branch> --only -m "Improve team submission defaults" --status-after
```

### Task 2: Include paths in team submission validation errors

**Files:**
- Modify: `packages/mcp/src/commands/submit-team-tasks.ts`
- Modify: `packages/mcp/src/commands/submit-task.ts` if needed
- Modify: `packages/mcp/__tests__/commands.test.ts`

- [ ] **Step 1: Write a failing test**

Submit an invalid team task item, for example:

```ts
{ position: "worker", objective: "", cwd: root }
```

Expected rejection message includes a useful path such as `tasks[0].objective` or `objective`, not only `Invalid input` / `expected string`.

- [ ] **Step 2: Implement a local formatter**

Add a small helper in the relevant command file:

```ts
function formatZodIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "input"}: ${issue.message}`)
    .join("; ");
}
```

Use it for per-item parse failures and, if low-risk, `runSubmitTask` invalid input failures.

- [ ] **Step 3: Verify**

```sh
bun test packages/mcp/__tests__/commands.test.ts --grep "submit-team-tasks"
bun run check
```

Expected: PASS.

---

## Chunk 2: Wait UX for MCP callers

### Task 3: Document and describe bounded wait polling

**Files:**
- Modify: `packages/mcp/src/operations.ts`
- Modify: `README.md`
- Modify: `docs/decisions/002-grouped-mcp-surface.md`
- Modify: `docs/guides/project-config.md` if wait defaults are mentioned there
- Test: `packages/mcp/__tests__/mcp-stdio-integ.test.ts` or `packages/mcp/__tests__/cli.test.ts`

- [ ] **Step 1: Write a failing test**

Add or update a test that inspects `tools/list` for the `wait` tool description/input schema text. Expected description should mention bounded waits, for example:

```ts
expect(waitTool.description).toContain("bounded");
expect(waitTool.description).toContain("poll");
```

- [ ] **Step 2: Update descriptions/docs**

In `packages/mcp/src/operations.ts`, change `wait` description to explicitly say:

> Use short bounded waits and repeat polling rather than one very long MCP request.

In docs, add a short example:

```json
{ "kind": "tasks", "task_ids": ["t_..."], "timeout_ms": 30000, "poll_interval_ms": 5000 }
```

- [ ] **Step 3: Verify**

```sh
bun test packages/mcp/__tests__/mcp-stdio-integ.test.ts --grep "tools/list"
bun run check
```

Expected: PASS.

### Task 4: Add a non-breaking wait timeout hint to output when timed out

**Files:**
- Modify: `packages/mcp/src/commands/wait-tasks.ts`
- Modify: `packages/mcp/src/commands/wait-team.ts`
- Modify: `packages/mcp/__tests__/commands.test.ts`

- [ ] **Step 1: Write failing tests**

For `wait_tasks` timeout and `wait_team` timeout, assert output includes:

```ts
expect(output.timed_out).toBe(true);
expect(output.next_action_hint).toContain("poll again");
```

- [ ] **Step 2: Extend schemas**

Add optional `next_action_hint?: string` to wait outputs. Populate it only on timeout:

```ts
next_action_hint: "Task is still running; call wait again with a short timeout or inspect get_status for attention_hint."
```

Keep it optional to avoid breaking non-timeout callers.

- [ ] **Step 3: Verify**

```sh
bun test packages/mcp/__tests__/commands.test.ts --grep "wait-tasks|wait-team"
bun run typecheck
```

Expected: PASS.

---

## Chunk 3: Terminal report summaries

### Task 5: Surface terminal child report messages in task result summaries

**Files:**
- Modify: `packages/mcp/src/commands/get-task-result.ts`
- Possibly modify: `packages/adapters/src/result-normalizer.ts` or adapter collect path only if needed
- Modify: `packages/mcp/__tests__/commands.test.ts`

- [ ] **Step 1: Write a failing test**

Create a task, report a terminal event with:

```ts
runReportTaskEvent(ctx, {
  task_id,
  child_token,
  type: "completed",
  message: "Implemented the refactor",
});
```

Then call `runGetTaskResult`. Expected:

```ts
expect(result.summary).toContain("Implemented the refactor");
```

Only use terminal event messages when adapter result summary is empty/missing.

- [ ] **Step 2: Implement minimal fallback**

In `runGetTaskResult`, after adapter collection, if normalized result summary is empty, read latest terminal event for that task from `task_events` and set summary to its message.

Rules:

- Do not overwrite a non-empty adapter summary.
- Only use terminal event types: `completed`, `failed`, `blocked`.
- If no message exists, preserve current behavior.

- [ ] **Step 3: Verify**

```sh
bun test packages/mcp/__tests__/commands.test.ts --grep "get-task-result|report-task-event"
bun run typecheck
```

Expected: PASS.

---

## Chunk 4: Attention handling docs

### Task 6: Document attention hints and steering recovery

**Files:**
- Modify: `README.md`
- Modify: `docs/decisions/002-grouped-mcp-surface.md`
- Possibly create/modify: `docs/guides/task-teams.md` if it exists later

- [ ] **Step 1: Update docs**

Add a short MCP parent loop section:

1. Submit team tasks.
2. Poll with bounded `wait`.
3. If `wait` times out, call `get_status`.
4. If `attention_hint` is present, call `steer_task` with a concise request to report status or finish.
5. Inspect `list({ kind: "events", task_id })` for terminal report messages.

- [ ] **Step 2: Verify docs**

```sh
bun run check
```

Expected: PASS.

---

## Suggested issue split

1. Improve `submit_team_tasks` defaults for AI callers.
2. Add path-aware validation messages for team submission.
3. Document bounded MCP wait polling and add wait timeout hints.
4. Surface terminal child report messages in task result summaries.
5. Document attention-hint + steer-task recovery loop.

Each issue can be implemented independently. Issues 1 and 2 are the highest priority because they reduce immediate friction for AI callers using Task Teams.
