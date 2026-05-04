# Adapter Run Modes Implementation Plan

> **For agentic workers:** REQUIRED: Use TDD for each implementation issue. Steps use checkbox (`- [ ]`) syntax for tracking. Keep PRs small; each issue below should be implementable independently by an AI coding worker.

**Goal:** Make every pane adapter default to interactive mode while allowing callers to opt into non-interactive batch mode via `adapter_options.mode: "batch"`.

**Architecture:** Add shared adapter run-mode parsing, have pane status/steering reflect the persisted task mode, then update each adapter's launch command builder. Keep adapter names stable and avoid adding `*-run` adapter kinds.

**Tech Stack:** TypeScript, Bun test, Zod schemas, cuekit pane adapter, tmux fake backend tests, GitHub issues/PRs.

---

## Issue 1: [#225 Shared adapter run-mode helpers and truthful status/steer behavior](https://github.com/takemo101/cuekit/issues/225)

**Outcome:** The shared pane adapter understands `adapter_options.mode`, includes actual mode in task status metadata, and rejects steering for batch tasks.

**Files:**
- Modify: `packages/adapters/src/adapter-options.ts`
- Modify: `packages/adapters/src/pane-adapter.ts`
- Modify: `packages/core/src/adapter-capabilities.ts`
- Modify: `packages/adapters/__tests__/claude-code-adapter.test.ts` or shared contract tests
- Modify: `packages/adapters/__tests__/adapter-contract.test.ts`

**Tasks:**
- [ ] Add `AdapterRunMode = "interactive" | "batch"`.
- [ ] Add `adapterRunModeFor(spec)` with fallback to `interactive`.
- [ ] Add descriptive `default_mode` and `supported_modes` to `AdapterCapabilitiesSchema`.
- [ ] Parse task `spec_json` in `createPaneAdapter.status()` and include `metadata.adapter_mode`.
- [ ] Return `supports_steering: false` in status for batch tasks.
- [ ] Make `steer()` return `steering_unsupported` for batch tasks.
- [ ] Add tests proving batch status/steer behavior.

**Validation:**

```sh
bun test packages/adapters
bun run typecheck
bun run check
```

---

## Issue 2: [#226 Add interactive/batch mode to pi adapter](https://github.com/takemo101/cuekit/issues/226)

**Outcome:** `pi` remains interactive by default and supports batch mode with `pi -p`.

**Files:**
- Modify: `packages/adapters/src/pi-adapter.ts`
- Modify/Create: `packages/adapters/__tests__/pi-adapter.test.ts` or `stub-adapters.test.ts`

**Tasks:**
- [ ] Export a pure `buildPiLaunchCommand()` if useful for tests.
- [ ] Test default command starts `pi '<prompt>'`.
- [ ] Test `adapter_options.mode: "batch"` starts `pi -p '<prompt>'`.
- [ ] Test invalid mode falls back to interactive.
- [ ] Shell-quote `piBin` and prompt.
- [ ] Keep model selection unchanged for this issue.

**Validation:**

```sh
bun test packages/adapters
bun run typecheck
bun run check
```

---

## Issue 3: [#227 Add batch mode to jcode adapter](https://github.com/takemo101/cuekit/issues/227)

**Outcome:** `jcode` keeps REPL FIFO interactive mode by default and supports batch mode with `jcode run`.

**Files:**
- Modify: `packages/adapters/src/jcode-adapter.ts`
- Modify: `packages/adapters/__tests__/jcode-adapter.test.ts`
- Modify: `docs/guides/jcode-adapter.md`

**Tasks:**
- [ ] Test default command remains FIFO `jcode repl`.
- [ ] Test `adapter_options.mode: "batch"` uses `jcode run`.
- [ ] Preserve `--model` and `--provider-profile` support in both modes.
- [ ] Ensure batch command does not use FIFO feeder.
- [ ] Ensure jcode-specific validation/reporting guidance remains in prompt.
- [ ] Document batch mode in the jcode guide.

**Validation:**

```sh
bun test packages/adapters/__tests__/jcode-adapter.test.ts
bun test packages/adapters
bun run typecheck
bun run check
```

---

## Issue 4: [#228 Make opencode default to TUI mode and move `run` to batch mode](https://github.com/takemo101/cuekit/issues/228)

**Outcome:** `opencode` becomes interactive/TUI by default, while existing `opencode run -- '<prompt>'` behavior remains available via `adapter_options.mode: "batch"`.

**Files:**
- Modify: `packages/adapters/src/opencode-adapter.ts`
- Modify: `packages/adapters/__tests__/stub-adapters.test.ts` or create `opencode-adapter.test.ts`
- Modify: `docs/issues/cuekit-opencode-run-positional-prompt.md`
- Modify: `docs/issues/cuekit-adapter-permission-bypass-design.md`
- Modify: `README.md`

**Tasks:**
- [ ] Test default command uses `opencode --prompt '<prompt>'`, not `opencode run`.
- [ ] Test batch mode preserves `opencode run -- '<prompt>'`.
- [ ] Keep `--model` support in both modes.
- [ ] Apply `--dangerously-skip-permissions` only to batch/run mode.
- [ ] Update docs to say OpenCode permission bypass is run/batch-specific.
- [ ] Update docs to say default OpenCode mode is interactive/TUI.

**Validation:**

```sh
bun test packages/adapters
bun run typecheck
bun run check
```

---

## Issue 5: [#229 Verify and add claude-code batch mode](https://github.com/takemo101/cuekit/issues/229)

**Outcome:** `claude-code` remains interactive by default and supports batch mode only after confirming the installed CLI's non-interactive flag.

**Files:**
- Modify: `packages/adapters/src/claude-code-adapter.ts`
- Modify: `packages/adapters/__tests__/claude-code-launch.test.ts`
- Modify: `README.md` if examples mention modes

**Tasks:**
- [ ] Verify `claude --help` supports `-p` or `--print` non-interactive mode.
- [ ] Test default command remains interactive.
- [ ] Test batch mode uses the verified print flag.
- [ ] Preserve model and permission bypass behavior as appropriate for the verified CLI.
- [ ] If CLI verification fails, document that claude-code batch mode is deferred and do not fake support.

**Validation:**

```sh
bun test packages/adapters/__tests__/claude-code-launch.test.ts
bun test packages/adapters
bun run typecheck
bun run check
```

---

## Issue 6: [#230 Documentation and project config examples](https://github.com/takemo101/cuekit/issues/230)

**Outcome:** Users can discover and configure interactive/batch mode consistently.

**Files:**
- Modify: `README.md`
- Modify: `docs/guides/project-config.md`
- Modify: `.cuekit.example.yaml` if appropriate
- Modify: `docs/README.md` if a new guide is added

**Tasks:**
- [ ] Document default interactive behavior.
- [ ] Document per-task batch opt-in:

```json
{
  "adapter_options": {
    "mode": "batch"
  }
}
```

- [ ] Document capability semantics: adapter list shows defaults; task status shows actual mode.
- [ ] Add examples for team tasks choosing batch mode for short review/check jobs.
- [ ] Mention that batch mode is not steerable.

**Validation:**

```sh
bun run check
```

---

## Recommended execution order

1. Shared run-mode helper/status/steer behavior.
2. `pi` mode support.
3. `jcode` batch support.
4. `opencode` default TUI + batch run mode.
5. `claude-code` batch mode after CLI verification.
6. Documentation polish.

## Final validation

After all issues land:

```sh
bun test packages/adapters
bun test packages/mcp
bun run typecheck
bun run check
bun test
```

Dogfood with a small team containing one interactive worker and one batch reviewer.
