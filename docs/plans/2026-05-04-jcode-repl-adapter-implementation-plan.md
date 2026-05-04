# jcode REPL Adapter Implementation Plan

> **For agentic workers:** REQUIRED: Use TDD for each implementation issue. Steps use checkbox (`- [ ]`) syntax for tracking. Keep PRs small and focused; each issue below should be implementable independently by an AI coding worker.

**Goal:** Add a `jcode` runtime adapter that runs `jcode repl` in a cuekit-managed tmux pane so parents can attach to and steer the live child task.

**Architecture:** Implement `jcode` as another `createPaneAdapter` consumer in `@cuekit/adapters`. The adapter builds a shell pipeline that sends the rendered cuekit task prompt into `jcode repl`, then keeps stdin open via `cat` so `steer_task` can send follow-up input to the pane. MCP only needs registry/test/docs updates after the adapter is exported.

**Tech Stack:** TypeScript, Bun test, Zod schemas from `@cuekit/core`, cuekit pane adapter, tmux fake backend tests, GitHub issues/PRs.

---

## Improvement Summary

1. **Prefer `jcode repl` over `jcode run`.** `run` is single-shot and exits; `repl` better matches cuekit's attach/steer semantics.
2. **Make the launch command pure and heavily tested.** The shell pipeline is the riskiest part, so expose a builder and test command shape/quoting without requiring real jcode.
3. **Keep the first adapter permission-safe.** Do not invent a permission-bypass option for jcode because the observed CLI help does not expose one.
4. **Register jcode through existing adapter surfaces.** `list({ kind: "adapters" })`, CLI adapter listing, and submit validation should work through the normal registry path.
5. **Add provider-profile support only after the basic adapter.** `--provider-profile` is useful but should be a separate small change so the base adapter can land safely.
6. **Document the real-runtime smoke path.** Unit tests cannot prove that `jcode repl` consumes piped stdin under tmux on every machine; document a manual/dogfood verification loop.

## File Map

- Create: `packages/adapters/src/jcode-adapter.ts`
  - Owns `JcodeAdapterOptions`, `BuildJcodeReplLaunchCommandOptions`, `buildJcodeReplLaunchCommand()`, and `createJcodeAdapter()`.
- Modify: `packages/adapters/src/index.ts`
  - Re-export the new adapter.
- Create: `packages/adapters/__tests__/jcode-adapter.test.ts`
  - Unit tests for capabilities and launch command construction.
- Modify: `packages/adapters/__tests__/stub-adapters.test.ts`
  - If existing broad adapter tests enumerate all built-ins, add `jcode` expectations there.
- Modify: `packages/mcp/src/bin.ts`
  - Register `createJcodeAdapter(db, panes, { logger })` alongside existing adapters.
- Modify: `packages/mcp/__tests__/commands.test.ts`
  - Update `list({ kind: "adapters" })` / submit smoke expectations if they assert exact adapter sets.
- Modify: `packages/mcp/__tests__/mcp-stdio-integ.test.ts`
  - Update adapter list expectations if exact counts/kinds are asserted.
- Modify: `README.md`
  - Replace “designed” wording once implemented and include `jcode` in adapter examples.
- Modify: `.cuekit.example.yaml` and/or `docs/guides/project-config.md`
  - Mention `jcode` as an allowed `submit.agent` / profile `agent_kind` example if appropriate.
- Optional follow-up: `packages/adapters/src/jcode-adapter.ts`
  - Add `adapter_options.provider_profile` support in a separate issue.

---

## Issue 1: [#213 Add the core jcode REPL adapter in `@cuekit/adapters`](https://github.com/takemo101/cuekit/issues/213)

**Outcome:** `@cuekit/adapters` exports a working `jcode` pane adapter with tested launch command shape and capabilities, but MCP does not register it yet.

**Files:**
- Create: `packages/adapters/src/jcode-adapter.ts`
- Create: `packages/adapters/__tests__/jcode-adapter.test.ts`
- Modify: `packages/adapters/src/index.ts`
- Modify if needed: `packages/adapters/__tests__/stub-adapters.test.ts`

- [ ] **Step 1: Write failing capability tests**

Create `packages/adapters/__tests__/jcode-adapter.test.ts` with a test that constructs `createJcodeAdapter(db, fakePanes)` and expects:

```ts
expect(adapter.kind).toBe("jcode");
expect(adapter.capabilities()).toMatchObject({
  agent_kind: "jcode",
  supports_steering: true,
  supports_attach: true,
  supports_model_selection: true,
  supports_artifacts: true,
  supports_live_progress: false,
});
```

Use existing adapter tests as patterns for in-memory DB and fake pane setup.

- [ ] **Step 2: Write failing launch-command tests**

Add tests for `buildJcodeReplLaunchCommand()`:

```ts
const command = buildJcodeReplLaunchCommand({
  agent_kind: "jcode",
  objective: "Say 'hello' and wait",
});
expect(command).toContain("printf '%s\\n'");
expect(command).toContain("; cat) | jcode repl --no-update");
expect(command).toContain("Child reporting contract:");
expect(command).not.toContain("jcode run");
```

Add a model quoting test:

```ts
const command = buildJcodeReplLaunchCommand({
  agent_kind: "jcode",
  objective: "x",
  model: "weird model's name",
});
expect(command).toContain("--model 'weird model'\\''s name'");
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```sh
bun test packages/adapters/__tests__/jcode-adapter.test.ts
```

Expected: fail because `jcode-adapter.ts` does not exist.

- [ ] **Step 4: Implement `jcode-adapter.ts` minimally**

Follow the existing `opencode-adapter.ts` / `claude-code-adapter.ts` structure:

```ts
import type { Database } from "bun:sqlite";
import type { Logger, TaskSpec } from "@cuekit/core";
import type { AgentAdapter } from "./agent-adapter.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import type { PaneBackend } from "./pane-backend.ts";
import { shellQuote } from "./shell-quote.ts";
import { renderTaskSpecPrompt } from "./task-spec-prompt.ts";

export interface JcodeAdapterOptions {
  launchCommandOverride?: (spec: TaskSpec) => string;
  jcodeBin?: string;
  logger?: Logger;
  cuekitHomeDir?: string;
}

export interface BuildJcodeReplLaunchCommandOptions {
  jcodeBin?: string;
}

export function buildJcodeReplLaunchCommand(
  spec: TaskSpec,
  options: BuildJcodeReplLaunchCommandOptions = {},
): string {
  const bin = options.jcodeBin ?? "jcode";
  const parts = [bin, "repl", "--no-update"];
  if (spec.model) {
    parts.push("--model", shellQuote(spec.model));
  }
  return `(printf '%s\\n' ${shellQuote(renderTaskSpecPrompt(spec))}; cat) | ${parts.join(" ")}`;
}

export function createJcodeAdapter(
  db: Database,
  panes: PaneBackend,
  options: JcodeAdapterOptions = {},
): AgentAdapter {
  const builder =
    options.launchCommandOverride ??
    ((spec: TaskSpec) => buildJcodeReplLaunchCommand(spec, { jcodeBin: options.jcodeBin }));

  return createPaneAdapter(
    {
      kind: "jcode",
      capabilities: {
        agent_kind: "jcode",
        supports_steering: true,
        supports_attach: true,
        supports_model_selection: true,
        supports_artifacts: true,
        supports_live_progress: false,
      },
      buildLaunchCommand: builder,
    },
    { db, panes, logger: options.logger, cuekitHomeDir: options.cuekitHomeDir },
  );
}
```

- [ ] **Step 5: Export from `packages/adapters/src/index.ts`**

Add:

```ts
export * from "./jcode-adapter.ts";
```

- [ ] **Step 6: Run focused tests**

Run:

```sh
bun test packages/adapters/__tests__/jcode-adapter.test.ts
bun test packages/adapters
```

Expected: pass.

- [ ] **Step 7: Commit**

Use GitButler flow in this repo. Commit message suggestion:

```sh
but commit <branch> --only -m "Add jcode REPL adapter"
```

---

## Issue 2: [#214 Register jcode in MCP and update adapter-surface tests/docs](https://github.com/takemo101/cuekit/issues/214)

**Outcome:** cuekit's real binary registers the `jcode` adapter, and MCP/CLI adapter listing exposes it.

**Files:**
- Modify: `packages/mcp/src/bin.ts`
- Modify: `packages/mcp/__tests__/commands.test.ts`
- Modify: `packages/mcp/__tests__/mcp-stdio-integ.test.ts`
- Modify: `README.md`
- Modify if useful: `.cuekit.example.yaml`, `docs/guides/project-config.md`, `docs/guides/agent-profiles.md`

- [ ] **Step 1: Write/update failing MCP expectations**

Find tests that assert adapter sets/counts:

```sh
rg -n "adapter|adapters|claude-code|opencode|pi" packages/mcp/__tests__ README.md docs/guides .cuekit.example.yaml
```

Update exact adapter-list expectations to include `jcode`.

Example assertion shape:

```ts
expect(result.adapters.map((adapter) => adapter.agent_kind)).toContain("jcode");
```

Prefer `toContain` over brittle exact ordering unless the existing test intentionally verifies ordering.

- [ ] **Step 2: Run focused MCP tests and verify failure**

Run:

```sh
bun test packages/mcp/__tests__/commands.test.ts
bun test packages/mcp/__tests__/mcp-stdio-integ.test.ts
```

Expected: fail because the binary registry does not yet include `jcode`.

- [ ] **Step 3: Register the adapter in `packages/mcp/src/bin.ts`**

Import `createJcodeAdapter` from `@cuekit/adapters` and register it:

```ts
registry.register(createClaudeCodeAdapter(db, panes, { logger }));
registry.register(createPiAdapter(db, panes, { logger }));
registry.register(createOpenCodeAdapter(db, panes, { logger }));
registry.register(createJcodeAdapter(db, panes, { logger }));
```

Keep registration near the other pane adapters.

- [ ] **Step 4: Update user-facing docs**

Update README adapter wording from planned/designed to implemented. Mention that `jcode` uses REPL mode for attach/steer behavior and does not currently expose cuekit permission-bypass semantics.

Where examples list valid `agent_kind` values (`claude-code`, `opencode`, `pi`), add `jcode` where natural.

- [ ] **Step 5: Run focused validation**

Run:

```sh
bun test packages/mcp/__tests__/commands.test.ts
bun test packages/mcp/__tests__/mcp-stdio-integ.test.ts
bun test packages/mcp
bun run typecheck
bun run check
```

Expected: pass.

- [ ] **Step 6: Commit**

Commit message suggestion:

```sh
but commit <branch> --only -m "Register jcode adapter in MCP"
```

---

## Issue 3: [#215 Add optional `provider_profile` support for jcode](https://github.com/takemo101/cuekit/issues/215)

**Outcome:** callers can pass `adapter_options.provider_profile` to select a named jcode provider profile, translating to `jcode repl --provider-profile <name>`.

**Files:**
- Modify: `packages/adapters/src/jcode-adapter.ts`
- Modify: `packages/adapters/__tests__/jcode-adapter.test.ts`
- Modify if docs mention jcode adapter options: `README.md`, `docs/guides/project-config.md`

- [ ] **Step 1: Write failing adapter-option tests**

Add a test using:

```ts
const command = buildJcodeReplLaunchCommand({
  agent_kind: "jcode",
  objective: "x",
  adapter_options: { provider_profile: "work profile" },
});
expect(command).toContain("--provider-profile 'work profile'");
```

Add negative/safety tests:

```ts
const command = buildJcodeReplLaunchCommand({
  agent_kind: "jcode",
  objective: "x",
  adapter_options: { provider_profile: 123 },
});
expect(command).not.toContain("--provider-profile");
```

This keeps untyped adapter options from producing unsafe CLI flags.

- [ ] **Step 2: Implement a tiny parser helper**

In `jcode-adapter.ts`, add:

```ts
function providerProfileFor(spec: TaskSpec): string | undefined {
  const value = spec.adapter_options?.provider_profile;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
```

Then insert before model or after model (ordering does not matter if tests pin the selected order):

```ts
const providerProfile = providerProfileFor(spec);
if (providerProfile) {
  parts.push("--provider-profile", shellQuote(providerProfile));
}
```

- [ ] **Step 3: Document the option**

Add a short note where adapter options are documented:

```json
{
  "agent_kind": "jcode",
  "adapter_options": {
    "provider_profile": "work"
  }
}
```

Explicitly say `dangerously_skip_permissions` is not supported for jcode unless verified later.

- [ ] **Step 4: Run validation**

Run:

```sh
bun test packages/adapters/__tests__/jcode-adapter.test.ts
bun test packages/adapters
bun run typecheck
bun run check
```

Expected: pass.

- [ ] **Step 5: Commit**

Commit message suggestion:

```sh
but commit <branch> --only -m "Support jcode provider profiles"
```

---

## Issue 4: [#216 Add jcode real-runtime smoke instructions and dogfood checklist](https://github.com/takemo101/cuekit/issues/216)

**Outcome:** maintainers have a repeatable manual smoke test for verifying that `jcode repl` behaves correctly under cuekit/tmux with attach and steering.

**Files:**
- Modify: `README.md`
- Modify or create: `docs/guides/jcode-adapter.md`
- Modify: `docs/README.md` if a new guide is created

- [ ] **Step 1: Add a guide with prerequisites**

Document:

```sh
command -v jcode
jcode auth status
jcode repl --help
```

Explain that automated tests do not require real jcode, but this smoke test does.

- [ ] **Step 2: Add a submit/attach smoke flow**

Example commands:

```sh
cuekit task submit --agent_kind jcode --objective "Say hello, then wait for a follow-up instruction."
cuekit task status <task_id>
tmux attach -t <session from attach_hint>
```

Tell the tester what to observe: jcode REPL starts, prompt is submitted, transcript appears under `.cuekit/tasks/<task_id>/transcript.txt`.

- [ ] **Step 3: Add a steering smoke flow**

Example:

```sh
cuekit task steer <task_id> --message "Now summarize the previous answer in one sentence."
```

Expected: follow-up appears in the attached pane and jcode responds.

- [ ] **Step 4: Add terminal-report expectations**

Ask smoke testers to ensure the child reports completion via MCP or CLI fallback when possible. If jcode cannot access cuekit MCP in its environment, document that transcript capture remains the fallback observation path.

- [ ] **Step 5: Run docs validation**

Run:

```sh
bun run check
```

Expected: pass.

- [ ] **Step 6: Commit**

Commit message suggestion:

```sh
but commit <branch> --only -m "Document jcode adapter smoke testing"
```

---

## Recommended Execution Order

1. Issue 1 — core adapter and unit tests.
2. Issue 2 — MCP registration and user-facing adapter list.
3. Issue 4 — smoke documentation, because it lets maintainers dogfood the newly registered adapter.
4. Issue 3 — provider-profile support, after the base adapter behavior is proven.

Issue 3 can be implemented before Issue 4 if a user needs provider profiles immediately.

## Final Validation for the Full Feature

After all issues are merged, run:

```sh
bun test packages/adapters
bun test packages/mcp
bun run typecheck
bun run check
bun test
```

Then dogfood with real jcode if installed/authenticated:

```sh
cuekit task submit --agent_kind jcode --objective "Say hello, then wait for a follow-up instruction."
cuekit task status <task_id>
cuekit task steer <task_id> --message "Thanks. Please report completed if cuekit reporting is available."
```
