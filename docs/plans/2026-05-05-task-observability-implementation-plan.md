# Task Observability Implementation Plan

> **For agentic workers:** REQUIRED: Use cuekit dogfood where useful (strategy/team or focused tasks), and keep changes small. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal, event-first task observability layer for child file self-reporting, timeout diagnostics, and conservative team stale-read warnings.

**Architecture:** Keep the first slice simple: no DB migration, no transcript parsing, and no automatic file tracking. Child agents optionally include a small observability shape in existing `task_events.payload`; core helpers safely extract that shape; MCP team summaries aggregate it.

**Tech Stack:** Bun, TypeScript, zod/incur schemas, SQLite-backed `@cuekit/store`, MCP command modules, tmux pane adapter.

---

## Reference Design

Read before implementing:

- `docs/designs/cuekit-task-observability-design.md`
- `packages/core/src/index.ts`
- `packages/store/src/task.ts`
- `packages/mcp/src/team-run-summary.ts`
- `packages/adapters/src/task-spec-prompt.ts`
- `packages/adapters/src/pane-adapter.ts`

## File Map

- Create `packages/core/src/task-observability.ts`
  - Owns the small payload type/schema and pure helper functions.
  - Must not import store, MCP, or adapter modules.
- Modify `packages/core/src/index.ts`
  - Export the new helper module.
- Add tests, preferably `packages/core/__tests__/task-observability.test.ts` if the package already uses this convention; otherwise follow the closest existing core test location.
- Modify `packages/mcp/src/team-run-summary.ts`
  - Add optional `observability` to the run summary schema and builder.
- Modify MCP tests that cover team run summaries, likely `packages/mcp/__tests__/commands.test.ts` or a focused new test file if existing tests are too broad.
- Modify `packages/adapters/src/task-spec-prompt.ts`
  - Add a short optional payload example to the child reporting contract.
- Modify `packages/adapters/src/pane-adapter.ts`
  - Append a timeout diagnostic `task_events` record when timeout handling fires.
- Modify adapter tests that exercise timeout behavior, likely under `packages/adapters/__tests__/` if present; otherwise add focused tests beside existing pane adapter tests.

## Chunk 1: Core Observability Helper

### Task 1: Add pure payload parsing and aggregation helpers

**Files:**
- Create: `packages/core/src/task-observability.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/__tests__/task-observability.test.ts` or nearest existing core test location

- [ ] **Step 1: Inspect existing core test layout**

Run:

```bash
find packages/core -maxdepth 3 -type f | sort
```

Expected: identify where core tests live and match the existing naming style.

- [ ] **Step 2: Write failing tests for payload parsing**

Cover these cases:

```ts
parseTaskObservabilityPayload({
  phase: "testing",
  files: { read: ["src/a.ts", "", "src/a.ts"], written: ["src/b.ts"] },
  diagnostic: { kind: "timeout", message: "timed out after 100ms" },
})
```

Expected parsed result:

```ts
{
  phase: "testing",
  files: { read: ["src/a.ts"], written: ["src/b.ts"] },
  diagnostic: { kind: "timeout", message: "timed out after 100ms" },
}
```

Also test:

- non-object payload returns `null`,
- invalid `files.read` / `files.written` are ignored,
- invalid diagnostic kind is ignored,
- empty parsed payload returns `null`.

- [ ] **Step 3: Run tests and confirm they fail**

Run the narrowest available command, for example:

```bash
bun test packages/core/__tests__/task-observability.test.ts
```

Expected: FAIL because the module does not exist yet.

- [ ] **Step 4: Implement the helper**

Create `packages/core/src/task-observability.ts` with small exported API:

```ts
export const TASK_DIAGNOSTIC_KINDS = ["timeout", "stale", "pane_disappeared"] as const;
export type TaskDiagnosticKind = (typeof TASK_DIAGNOSTIC_KINDS)[number];

export interface TaskObservabilityPayload {
  phase?: string;
  files?: {
    read?: string[];
    written?: string[];
  };
  diagnostic?: {
    kind: TaskDiagnosticKind;
    message?: string;
  };
}

export function parseTaskObservabilityPayload(payload: unknown): TaskObservabilityPayload | null;
export function observedFilesFromPayloads(payloads: unknown[]): { read: string[]; written: string[] };
export function diagnosticsFromPayloads(payloads: unknown[]): Array<{ kind: TaskDiagnosticKind; message?: string }>;
export function intersectObservedFiles(read: string[], written: string[]): string[];
```

Implementation rules:

- Use plain type guards or zod; prefer plain guards if shorter.
- Do not throw on malformed payloads.
- Trim string paths; drop empty strings; dedupe preserving first-seen order.
- Only include `files` if at least one side is non-empty.
- Only include `diagnostic` if kind is recognized.

- [ ] **Step 5: Export from core index**

Add to `packages/core/src/index.ts`:

```ts
export * from "./task-observability.ts";
```

- [ ] **Step 6: Run narrow tests**

Run:

```bash
bun test packages/core/__tests__/task-observability.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run package checks**

Run:

```bash
bun run check
bun run typecheck
```

Expected: PASS.

## Chunk 2: Team Run Summary Aggregation

### Task 2: Surface observability in team run summaries

**Files:**
- Modify: `packages/mcp/src/team-run-summary.ts`
- Test: existing MCP command/team summary tests or new focused `packages/mcp/__tests__/team-run-summary.test.ts`

- [ ] **Step 1: Inspect current tests for `buildTeamRunSummary`**

Run:

```bash
rg "buildTeamRunSummary|run_summary|terminal_reports|open_attention" packages/mcp/__tests__ -n
```

Expected: identify whether to extend an existing test file or create a focused one.

- [ ] **Step 2: Write failing tests for file aggregation**

Create events for two team tasks:

- task A payload: `{ files: { read: ["src/a.ts"] } }`
- task B payload: `{ files: { written: ["src/a.ts", "src/b.ts"] } }`

Expected `run_summary.observability`:

```ts
{
  files_read: ["src/a.ts"],
  files_written: ["src/a.ts", "src/b.ts"],
  diagnostics: [],
  warnings: [{
    kind: "stale_read",
    paths: ["src/a.ts"],
    message: expect.stringContaining("re-read may be needed"),
  }],
}
```

- [ ] **Step 3: Write failing tests for diagnostics**

Create an event with payload:

```json
{"diagnostic":{"kind":"timeout","message":"timed out after 100ms"}}
```

Expected summary includes:

```ts
observability.diagnostics: [
  { task_id: "t_worker", kind: "timeout", message: "timed out after 100ms" }
]
```

- [ ] **Step 4: Write failing test for empty observability omission**

When no events contain recognized observability payloads, expected `run_summary.observability` is absent.

- [ ] **Step 5: Run narrow tests and confirm they fail**

Run the chosen test command, for example:

```bash
bun test packages/mcp/__tests__/team-run-summary.test.ts
```

Expected: FAIL because schema/builder do not include observability yet.

- [ ] **Step 6: Update `TeamRunSummarySchema`**

Add optional `observability` shape:

```ts
observability: z.object({
  files_read: z.array(z.string()),
  files_written: z.array(z.string()),
  diagnostics: z.array(z.object({
    task_id: z.string(),
    kind: z.string(),
    message: z.string().optional(),
  })),
  warnings: z.array(z.object({
    kind: z.literal("stale_read"),
    message: z.string(),
    paths: z.array(z.string()),
  })).optional(),
}).optional()
```

Keep it optional.

- [ ] **Step 7: Update `buildTeamRunSummary`**

Use the core helper to parse each event payload. Keep aggregation local and simple:

- global union of files read,
- global union of files written,
- diagnostics with task id,
- one stale-read warning if read/write intersection is non-empty.

Warning message:

```text
Some tasks read files that were also written by team tasks; re-read may be needed.
```

- [ ] **Step 8: Run narrow tests**

Run:

```bash
bun test <chosen mcp test file>
```

Expected: PASS.

- [ ] **Step 9: Run broader MCP tests**

Run targeted existing MCP tests that cover team status/wait/result, for example:

```bash
bun test packages/mcp/__tests__/commands.test.ts
bun test packages/mcp/__tests__/cli.test.ts
```

Expected: PASS.

## Chunk 3: Child Prompt Guidance and Timeout Diagnostics

### Task 3: Teach children the optional payload and record adapter timeout diagnostics

**Files:**
- Modify: `packages/adapters/src/task-spec-prompt.ts`
- Modify: `packages/adapters/src/pane-adapter.ts`
- Test: existing adapter prompt/timeout tests or new focused tests

- [ ] **Step 1: Write/extend prompt test**

Find prompt tests:

```bash
rg "Child reporting contract|renderTaskSpecPrompt|task-spec-prompt" packages -n
```

Add expectation that the rendered prompt includes a short observability example with `phase`, `files.read`, and `files.written`.

- [ ] **Step 2: Update child reporting contract text**

In `packages/adapters/src/task-spec-prompt.ts`, add one concise bullet:

```text
- When useful, include simple observability payloads such as {"phase":"testing","files":{"read":["src/a.ts"],"written":["src/a.ts"]}}; report only the main files relevant to coordination/review.
```

Do not make this mandatory.

- [ ] **Step 3: Locate timeout tests**

Run:

```bash
rg "timed_out|timeout_ms|hasTimedOut|killTask" packages/adapters packages/mcp packages/store -n
```

Expected: identify existing test coverage for pane timeout behavior.

- [ ] **Step 4: Write failing timeout diagnostic test**

Arrange a task with `timeout_ms`, make `panes.isAlive(task_id)` return true, trigger `status(task_id)` after timeout, and assert:

- returned status is `timed_out`,
- `listTaskEvents(db, task_id)` includes a `log` event,
- event payload has `diagnostic.kind === "timeout"`,
- event message includes `timed out after`.

- [ ] **Step 5: Run narrow timeout test and confirm failure**

Run the chosen adapter test command.

Expected: FAIL because no diagnostic event is appended yet.

- [ ] **Step 6: Append timeout diagnostic event in pane adapter**

In `packages/adapters/src/pane-adapter.ts`, import `appendTaskEvent` and `randomUUID` if needed. In the timeout branch, append before or after `completeTask`:

```ts
appendTaskEvent(db, {
  id: `e_${randomUUID()}`,
  task_id,
  type: "log",
  message: `task timed out after ${timeoutMsFor(live)}ms`,
  payload: {
    diagnostic: {
      kind: "timeout",
      message: `timed out after ${timeoutMsFor(live)}ms`,
    },
  },
});
```

Implementation note: avoid calling `timeoutMsFor(live)` repeatedly if it can be stored once.

- [ ] **Step 7: Run narrow adapter tests**

Run the chosen adapter tests.

Expected: PASS.

- [ ] **Step 8: Run checks**

Run:

```bash
bun run check
bun run typecheck
```

Expected: PASS.

## Chunk 4: End-to-End Validation and Documentation Check

### Task 4: Validate the integrated behavior

**Files:**
- Usually no new files unless tests expose a missing fixture.
- Possibly update docs only if implementation deviates from `docs/designs/cuekit-task-observability-design.md`.

- [ ] **Step 1: Run all targeted tests from prior chunks**

Run:

```bash
bun test packages/core/__tests__/task-observability.test.ts
bun test packages/mcp/__tests__/commands.test.ts
bun test packages/mcp/__tests__/cli.test.ts
# plus the adapter test file chosen in Chunk 3
```

Expected: PASS.

- [ ] **Step 2: Run full validation**

Run:

```bash
bun run check
bun run typecheck
bun test
```

Expected: PASS. If `bun test` is too broad or flaky, document the exact failure and run the relevant package suites.

- [ ] **Step 3: Dogfood with a small team if practical**

Use cuekit MCP or CLI fallback to run a tiny strategy/team where a worker reports payload files and a reviewer/result surfaces `run_summary.observability`.

Expected evidence:

- team result includes files read/written,
- stale-read warning appears when read/write overlap exists,
- no regression in terminal reports/open attention.

- [ ] **Step 4: Final review**

Request a focused code review. Review prompt should include:

- design doc path,
- implementation files,
- tests run,
- explicit ask to check simplicity, backward compatibility, and no DB migration.

Expected: no blocking issues.

## Suggested GitHub Issue Split

1. **Core helper** — pure parsing/aggregation helpers and tests.
2. **Team summary aggregation** — MCP `run_summary.observability` and tests.
3. **Prompt + timeout diagnostics** — child contract text and adapter timeout event/tests.
4. **Integration validation** — full checks, dogfood, and final review.

Each issue should reference `docs/designs/cuekit-task-observability-design.md` and this plan.
