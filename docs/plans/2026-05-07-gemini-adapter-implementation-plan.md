# gemini CLI Adapter Implementation Plan

> **For agentic workers:** REQUIRED: Use TDD for each implementation issue. Steps use checkbox (`- [ ]`) syntax for tracking. Keep PRs small and focused; each issue below should be implementable independently by an AI coding worker.

**Goal:** Add a `gemini` runtime adapter that runs Google Gemini CLI in a cuekit-managed tmux pane so parents can attach to and steer the live child task, with first-class support for both interactive (default) and batch modes.

**Architecture:** Implement `gemini` as another `createPaneAdapter` consumer in `@cuekit/adapters`. Because the CLI exposes both `gemini '<prompt>'` (interactive) and `gemini -p '<prompt>'` (non-interactive) first-class with the same flag set, support both run modes from day one through the shared `adapter_options.mode` projection. Always pass `--skip-trust` so unattended panes never stall on Gemini's per-directory trust gate (which, unlike Claude Code, is **not** auto-skipped in non-TTY mode). Permission bypass uses `-y` (yolo), defaulted on through the shared `shouldDangerouslySkipPermissions` and removable only via explicit `dangerously_skip_permissions: false`. MCP only needs registry/test/docs updates after the adapter is exported.

**Tech Stack:** TypeScript, Bun test, Zod schemas from `@cuekit/core`, cuekit pane adapter, tmux fake backend tests, GitHub issues/PRs.

**Design reference:** [`docs/designs/cuekit-gemini-adapter-design.md`](../designs/cuekit-gemini-adapter-design.md)

---

## Improvement Summary

1. **Both run modes from day one.** `interactive` (positional prompt) and `batch` (`-p` value form). Run-mode capability projection from the shared adapter handles `supports_steering: false` for batch and `steering_unsupported` rejection on `steer_task`.
2. **Always pass `--skip-trust`.** Gemini's per-directory trust gate is enforced even in non-TTY mode. The flag is unconditional — `dangerously_skip_permissions: false` does **not** remove it (unlike `-y`).
3. **Default `-y` (yolo) on, opt-out via boolean.** Aligned with claude-code/opencode permission-bypass design.
4. **Pure builder.** `buildGeminiLaunchCommand(spec)` returns the exact shell-command string the pane backend will run. Heavily tested without spawning gemini or tmux.
5. **Capabilities advertise both modes.** `default_mode: "interactive"`, `supported_modes: ["interactive", "batch"]`. No `auto_edit` / `plan` / ACP / model-router opt-ins in v0.
6. **No core schema change.** `agent_kind` is `z.string().min(1)` in `@cuekit/core` — adding `gemini` is a string at submit-time, not an enum extension.
7. **`cuekit doctor` adds a one-line binary probe.** The adapter list in `packages/cli/src/doctor.ts` already iterates `ADAPTER_EXECUTABLES`; adding `gemini` is mechanical. Auth probe is best-effort.

## File Map

- Create: `packages/adapters/src/gemini-adapter.ts`
  - Owns `GeminiAdapterOptions`, `BuildGeminiLaunchCommandOptions`, `buildGeminiLaunchCommand()`, and `createGeminiAdapter()`.
- Modify: `packages/adapters/src/index.ts`
  - Re-export the new adapter.
- Create: `packages/adapters/__tests__/gemini-adapter.test.ts`
  - Unit tests for capabilities and launch command construction (both run modes, `--skip-trust`, `-y` default + opt-out, model quoting, awkward prompts).
- Modify if needed: `packages/adapters/__tests__/stub-adapters.test.ts`
  - If existing broad adapter tests enumerate all built-ins, add `gemini` expectations there.
- Modify: `packages/mcp/src/bin.ts`
  - Register `createGeminiAdapter(db, panes, { logger })` alongside existing adapters.
- Modify: `packages/mcp/__tests__/commands.test.ts`
  - Update `list({ kind: "adapters" })` / submit smoke expectations if they assert exact adapter sets.
- Modify: `packages/mcp/__tests__/mcp-stdio-integ.test.ts`
  - Update adapter list expectations if exact counts/kinds are asserted.
- Modify: `packages/cli/src/doctor.ts`
  - Append `{ kind: "gemini", command: "gemini" }` to `ADAPTER_EXECUTABLES`.
- Modify: `packages/cli/__tests__/doctor.test.ts`
  - Update adapter-presence expectations.
- Modify: `README.md`
  - Add `gemini` to the adapter list and adapter-defaults section.
- Modify: `AGENTS.md`
  - Update the `@cuekit/adapters` line to include `gemini` once it ships.
- Modify: `docs/designs/cuekit-adapter-run-modes-design.md`
  - Add a `gemini` row to the command matrix.
- Modify: `.cuekit.example.yaml` and/or `docs/guides/project-config.md`
  - Mention `gemini` as a valid `submit.agent` / profile `agent_kind` example if natural.
- Create: `docs/guides/gemini-adapter.md`
  - Real-runtime smoke test recipe (submit/attach/steer/cancel + batch-mode steering rejection).
- Modify: `docs/guides/README.md`
  - List the new guide and pair it with the design note.

---

## Issue 1: [#356 Add the core gemini adapter in `@cuekit/adapters`](https://github.com/takemo101/cuekit/issues/356)

**Outcome:** `@cuekit/adapters` exports a working `gemini` pane adapter with tested launch command shape, both run modes, `--skip-trust` always present, and capability projection that produces `supports_steering: false` for batch tasks. MCP does not register it yet.

**Files:**
- Create: `packages/adapters/src/gemini-adapter.ts`
- Create: `packages/adapters/__tests__/gemini-adapter.test.ts`
- Modify: `packages/adapters/src/index.ts`
- Modify if needed: `packages/adapters/__tests__/stub-adapters.test.ts`

- [ ] **Step 1: Write failing capability tests**

Create `packages/adapters/__tests__/gemini-adapter.test.ts` and assert:

```ts
const adapter = createGeminiAdapter(db, fakePanes);
expect(adapter.kind).toBe("gemini");
expect(adapter.capabilities()).toMatchObject({
  agent_kind: "gemini",
  supports_steering: true,
  supports_attach: true,
  supports_model_selection: true,
  supports_artifacts: true,
  supports_live_progress: false,
  default_mode: "interactive",
  supported_modes: ["interactive", "batch"],
});
```

Use existing `claude-code-adapter.test.ts` / `opencode-adapter.test.ts` as patterns for in-memory DB and fake pane setup.

- [ ] **Step 2: Write failing launch-command tests**

Pin the exact launch shape across run modes and option combinations:

```ts
// Default (interactive, bypass on)
const interactive = buildGeminiLaunchCommand({
  agent_kind: "gemini",
  objective: "x",
});
expect(interactive).toContain("gemini --skip-trust -y");
expect(interactive).not.toContain("-p ");
expect(interactive).toContain("'<rendered prompt body>'"); // shell-quoted

// Model passthrough
const withModel = buildGeminiLaunchCommand({
  agent_kind: "gemini",
  objective: "x",
  model: "gemini-2.5-flash",
});
expect(withModel).toContain("-m 'gemini-2.5-flash'");

// Batch mode uses -p with the prompt as its value
const batch = buildGeminiLaunchCommand({
  agent_kind: "gemini",
  objective: "x",
  adapter_options: { mode: "batch" },
});
expect(batch).toContain("--skip-trust");
expect(batch).toContain("-y");
expect(batch).toMatch(/-p '.*'/);

// Permission opt-out drops -y but keeps --skip-trust
const safe = buildGeminiLaunchCommand({
  agent_kind: "gemini",
  objective: "x",
  adapter_options: { dangerously_skip_permissions: false },
});
expect(safe).toContain("--skip-trust");
expect(safe).not.toContain(" -y ");
expect(safe).not.toMatch(/ -y$/);

// Quoting: model with single quotes
const quoted = buildGeminiLaunchCommand({
  agent_kind: "gemini",
  objective: "x",
  model: "weird model's name",
});
expect(quoted).toContain("-m 'weird model'\\''s name'");

// Quoting: prompts that start with `-` must be safely quoted, not parsed as flags
const dashy = buildGeminiLaunchCommand({
  agent_kind: "gemini",
  objective: "-rm -rf /",
});
expect(dashy).toMatch(/'-rm -rf \/'$/);
```

- [ ] **Step 3: Run tests and verify they fail**

```sh
bun test packages/adapters/__tests__/gemini-adapter.test.ts
```

Expected: fail because `gemini-adapter.ts` does not exist.

- [ ] **Step 4: Implement `gemini-adapter.ts` minimally**

Mirror `claude-code-adapter.ts` structure:

```ts
import type { Database } from "bun:sqlite";
import type { Logger, TaskSpec } from "@cuekit/core";
import { adapterRunModeFor, shouldDangerouslySkipPermissions } from "./adapter-options.ts";
import type { AgentAdapter } from "./agent-adapter.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import type { PaneBackend } from "./pane-backend.ts";
import { shellQuote } from "./shell-quote.ts";
import { renderTaskSpecPrompt } from "./task-spec-prompt.ts";

export interface GeminiAdapterOptions {
  launchCommandOverride?: (spec: TaskSpec) => string;
  geminiBin?: string;
  availableModels?: string[];
  logger?: Logger;
  cuekitHomeDir?: string;
}

export interface BuildGeminiLaunchCommandOptions {
  geminiBin?: string;
}

export function buildGeminiLaunchCommand(
  spec: TaskSpec,
  options: BuildGeminiLaunchCommandOptions = {},
): string {
  const bin = options.geminiBin ?? "gemini";
  const parts: string[] = [bin, "--skip-trust"];
  if (shouldDangerouslySkipPermissions(spec)) {
    parts.push("-y");
  }
  if (spec.model) {
    parts.push("-m", shellQuote(spec.model));
  }
  const prompt = shellQuote(renderTaskSpecPrompt(spec));
  if (adapterRunModeFor(spec) === "batch") {
    parts.push("-p", prompt);
  } else {
    parts.push(prompt);
  }
  return parts.join(" ");
}

export function createGeminiAdapter(
  db: Database,
  panes: PaneBackend,
  options: GeminiAdapterOptions = {},
): AgentAdapter {
  const availableModels =
    options.availableModels ?? ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
  const builder =
    options.launchCommandOverride ??
    ((spec: TaskSpec) => buildGeminiLaunchCommand(spec, { geminiBin: options.geminiBin }));

  return createPaneAdapter(
    {
      kind: "gemini",
      capabilities: {
        agent_kind: "gemini",
        supports_steering: true,
        supports_attach: true,
        supports_model_selection: true,
        available_models: availableModels,
        supports_artifacts: true,
        supports_live_progress: false,
        default_mode: "interactive",
        supported_modes: ["interactive", "batch"],
      },
      buildLaunchCommand: builder,
    },
    { db, panes, logger: options.logger, cuekitHomeDir: options.cuekitHomeDir },
  );
}
```

Confirm the actual current model IDs accepted by Gemini CLI before pinning `availableModels`. The Gemini CLI itself does not validate — the API does — so pick names known to be live (do not invent aliases like `flash`/`pro` that the CLI does not accept).

- [ ] **Step 5: Export from `packages/adapters/src/index.ts`**

```ts
export * from "./gemini-adapter.ts";
```

- [ ] **Step 6: Run focused tests**

```sh
bun test packages/adapters/__tests__/gemini-adapter.test.ts
bun test packages/adapters
bun run typecheck
bun run check
```

Expected: pass.

- [ ] **Step 7: Commit**

Commit message suggestion:

```
Add gemini CLI adapter (interactive + batch, --skip-trust always on)
```

---

## Issue 2: [#357 Register gemini in MCP and update adapter-surface tests/docs](https://github.com/takemo101/cuekit/issues/357)

**Outcome:** cuekit's real binary registers the `gemini` adapter, MCP/CLI adapter listing exposes it, the adapter-run-modes design's command matrix lists `gemini`, and the README/AGENTS.md adapter mentions are updated.

**Files:**
- Modify: `packages/mcp/src/bin.ts`
- Modify: `packages/mcp/__tests__/commands.test.ts`
- Modify: `packages/mcp/__tests__/mcp-stdio-integ.test.ts`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/designs/cuekit-adapter-run-modes-design.md`
- Modify if natural: `.cuekit.example.yaml`, `docs/guides/project-config.md`, `docs/guides/agent-profiles.md`

- [ ] **Step 1: Find tests that assert adapter sets/counts**

```sh
rg -n "adapter|adapters|claude-code|opencode|jcode|pi" packages/mcp/__tests__ README.md docs/guides .cuekit.example.yaml
```

Note which assertions need `gemini` added.

- [ ] **Step 2: Update failing MCP expectations**

Prefer `toContain` over brittle exact ordering unless the existing test intentionally verifies ordering:

```ts
expect(result.adapters.map((adapter) => adapter.agent_kind)).toContain("gemini");
```

For exact counts, bump them (e.g. `expect(adapters).toHaveLength(N + 1)`).

- [ ] **Step 3: Run focused MCP tests and verify failure**

```sh
bun test packages/mcp/__tests__/commands.test.ts
bun test packages/mcp/__tests__/mcp-stdio-integ.test.ts
```

Expected: fail because the binary registry does not yet include `gemini`.

- [ ] **Step 4: Register the adapter in `packages/mcp/src/bin.ts`**

Import `createGeminiAdapter` from `@cuekit/adapters` and register it next to the other pane adapters:

```ts
registry.register(createClaudeCodeAdapter(db, panes, { logger }));
registry.register(createPiAdapter(db, panes, { logger }));
registry.register(createOpenCodeAdapter(db, panes, { logger }));
registry.register(createJcodeAdapter(db, panes, { logger }));
registry.register(createGeminiAdapter(db, panes, { logger }));
```

- [ ] **Step 5: Update README + AGENTS.md adapter mentions**

In `README.md`:
- Add `gemini` to the Packages table description for `@cuekit/adapters`.
- Add an "Adapter defaults" sentence:
  > `gemini` defaults to runtime permission bypass (`-y`) and always passes `--skip-trust` so unattended panes don't stall on the trusted-folder gate.

In `AGENTS.md`:
- Update the `@cuekit/adapters` line to include `gemini` alongside `claude-code / pi / opencode / jcode repl`.

- [ ] **Step 6: Add the `gemini` row to the adapter-run-modes command matrix**

In `docs/designs/cuekit-adapter-run-modes-design.md`, append:

```markdown
| `gemini` | `gemini --skip-trust [-y] '<prompt>'` | `gemini --skip-trust [-y] -p '<prompt>'` |
```

- [ ] **Step 7: Run focused validation**

```sh
bun test packages/mcp/__tests__/commands.test.ts
bun test packages/mcp/__tests__/mcp-stdio-integ.test.ts
bun test packages/mcp
bun run typecheck
bun run check
```

Expected: pass.

- [ ] **Step 8: Commit**

Commit message suggestion:

```
Register gemini adapter in MCP and update surface docs
```

---

## Issue 3: [#358 Add gemini binary probe to cuekit doctor](https://github.com/takemo101/cuekit/issues/358)

**Outcome:** `cuekit doctor` reports whether the `gemini` binary is on `PATH`, in the same shape as the existing claude-code / pi / opencode / jcode probes.

**Files:**
- Modify: `packages/cli/src/doctor.ts`
- Modify: `packages/cli/__tests__/doctor.test.ts`

- [ ] **Step 1: Write a failing test**

In `packages/cli/__tests__/doctor.test.ts`, extend the adapter-probe test to assert that the doctor output includes a line for `adapter gemini` when a fake exec runner reports the binary as available, and a fail line when it is not. Mirror the existing claude-code / opencode / jcode assertions.

- [ ] **Step 2: Run tests and verify they fail**

```sh
bun test packages/cli/__tests__/doctor.test.ts
```

Expected: fail because the `ADAPTER_EXECUTABLES` constant does not yet include `gemini`.

- [ ] **Step 3: Add gemini to `ADAPTER_EXECUTABLES`**

In `packages/cli/src/doctor.ts`:

```ts
const ADAPTER_EXECUTABLES = [
  { kind: "claude-code", command: "claude" },
  { kind: "pi", command: "pi" },
  { kind: "opencode", command: "opencode" },
  { kind: "jcode", command: "jcode" },
  { kind: "gemini", command: "gemini" },
] as const;
```

No auth probe is added in this issue. The design doc lists the auth-probe shape as an open question; if the implementer wants to land a best-effort probe, do it as a follow-up issue scoped only to that.

- [ ] **Step 4: Run validation**

```sh
bun test packages/cli/__tests__/doctor.test.ts
bun test packages/cli
bun run typecheck
bun run check
```

Expected: pass.

- [ ] **Step 5: Commit**

Commit message suggestion:

```
Add gemini binary probe to cuekit doctor
```

---

## Issue 4: [#359 Document gemini adapter smoke testing](https://github.com/takemo101/cuekit/issues/359)

**Outcome:** maintainers and AI workers have a repeatable manual smoke test for verifying that `gemini` behaves correctly under cuekit/tmux with attach, steering, and batch-mode steering rejection.

**Files:**
- Create: `docs/guides/gemini-adapter.md`
- Modify: `docs/guides/README.md`
- Modify: `README.md` (manual smoke tests section)

- [ ] **Step 1: Create the guide with prerequisites**

In `docs/guides/gemini-adapter.md`, document:

```sh
command -v gemini
gemini --version
# If the user has never used gemini in this directory, run an interactive
# session once to populate ~/.gemini/trustedFolders.json before running the
# smoke test against the live API.
```

Explain that automated tests do not require real gemini, but this smoke test does. Pair the guide with [`../designs/cuekit-gemini-adapter-design.md`](../designs/cuekit-gemini-adapter-design.md).

- [ ] **Step 2: Add a submit/attach smoke flow**

```sh
cuekit task submit \
  --agent_kind gemini \
  --model gemini-2.5-flash \
  --objective "Say 'hello' and wait for a follow-up instruction."
cuekit task status <task_id>
tmux attach-session -t cuekit-task-<task_id>
```

Expected observations: gemini REPL starts, `--skip-trust` is visible in the pane's command line if inspected (via `tmux capture-pane`), prompt is delivered, transcript appears under `<cwd>/.cuekit/tasks/<task_id>/transcript.txt`.

- [ ] **Step 3: Add a steering smoke flow**

```sh
cuekit task steer --task_id <task_id> --message "Now summarize your previous answer in one sentence."
```

Expected: follow-up appears in the attached pane and gemini responds.

- [ ] **Step 4: Add a batch-mode flow**

```sh
cuekit task submit \
  --agent_kind gemini \
  --model gemini-2.5-flash \
  --objective "review this diff once and exit" \
  --adapter_options '{"mode":"batch"}'
cuekit task status --task_id <task_id>   # supports_steering should be false
cuekit task steer --task_id <task_id> --message "ignored"  # should reject
```

Expected: status reports `metadata.adapter_mode: "batch"` and `supports_steering: false`. `steer_task` rejects with `steering_unsupported`.

- [ ] **Step 5: Add cleanup expectations**

```sh
cuekit task cancel --task_id <task_id>
tmux ls   # cuekit-task-<id> session should be gone
```

The transcript file should remain.

- [ ] **Step 6: Wire the guide into the docs index**

Update `docs/guides/README.md` to list the new guide and pair it with the design note. Update the "Manual smoke tests" section in `README.md` to mention the new guide alongside the existing jcode reference.

- [ ] **Step 7: Run docs validation**

```sh
bun run check
```

Expected: pass.

- [ ] **Step 8: Commit**

Commit message suggestion:

```
Document gemini adapter smoke testing
```

---

## Recommended Execution Order

1. **Issue 1** — core adapter + unit tests. Required by all others.
2. **Issue 2** — MCP registration + user-facing adapter list + run-modes matrix.
3. **Issue 3** — doctor probe (one-line addition; can run in parallel with Issue 4 once Issue 1 is merged).
4. **Issue 4** — smoke documentation, last because it depends on the registered adapter being usable end-to-end.

Issue 3 can be implemented before Issue 2 if a worker prefers, since they touch disjoint files; pick whichever path keeps PRs small.

## Final Validation for the Full Feature

After all issues are merged:

```sh
bun test packages/adapters
bun test packages/mcp
bun test packages/cli
bun run typecheck
bun run check
bun test
```

Then dogfood with real gemini if installed and authenticated:

```sh
cuekit task submit --agent_kind gemini --model gemini-2.5-flash \
                   --objective "Say hello, then wait for a follow-up instruction."
cuekit task steer --task_id <task_id> --message "Thanks. Please report completed if cuekit reporting is available."
```

## Out of Scope (deliberately deferred)

- `--approval-mode` 4-value opt-in surface (`auto_edit` / `plan` / `default` / `yolo`). Reconsider if a real role profile (e.g. `reviewer`) needs `plan` mode.
- Structured `result.json` projection from `gemini -p --output-format json`. The same improvement applies symmetrically across adapters and should not be built one-off here.
- `--acp` (Agent Communication Protocol) integration. v0 keeps every adapter on the shared pane backend.
- `--session-id` / `--resume` cross-task continuity.
- Gemma Model Router (auto model selection). User-level setting, orthogonal to the adapter — covered by simply omitting `--model` at submit time.
- More sophisticated `cuekit doctor` auth probe than binary detection.
