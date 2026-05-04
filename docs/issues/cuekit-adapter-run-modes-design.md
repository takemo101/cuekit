# Design: adapter interactive/batch run modes

## Problem

cuekit's pane adapters are currently inconsistent about process mode and advertised capabilities:

- `pi` starts the normal interactive TUI with an initial prompt, so `supports_steering: true` is plausible.
- `jcode` starts `jcode repl` through a FIFO feeder, so `supports_steering: true` is intentional.
- `opencode` currently uses `opencode run`, which is a single-shot command, but still advertises `supports_steering: true`.
- `claude-code` starts the normal interactive CLI today, but could also support a print/batch mode if the CLI shape is confirmed.

This makes it hard for callers to choose between two valid workflows:

1. **Interactive child tasks** — default for cuekit: attach to the pane, steer the running agent, and rely on child reporting for terminal status.
2. **Batch child tasks** — useful for short unattended checks: run one prompt, stream output, exit, and infer terminal status from process exit.

## Decision

Add a shared adapter run mode option:

```json
{
  "adapter_options": {
    "mode": "interactive"
  }
}
```

Supported values:

- `interactive` — default, attachable and steerable when the runtime supports it.
- `batch` — non-interactive/single-shot mode; attach may show streaming output, but steering is not supported.

Invalid/missing values fall back to `interactive` for compatibility with existing loose `adapter_options` handling.

## Adapter command matrix

| Adapter | `interactive` default | `batch` |
|---|---|---|
| `pi` | `pi '<prompt>'` | `pi -p '<prompt>'` |
| `jcode` | existing `jcode repl` FIFO feeder | `jcode run '<prompt>'` |
| `opencode` | `opencode --prompt '<prompt>'` | `opencode run [--dangerously-skip-permissions] -- '<prompt>'` |
| `claude-code` | `claude '<prompt>'` | `claude -p '<prompt>'` or `claude --print '<prompt>'` after CLI verification |

## Capability model

### Adapter list

`list({ kind: "adapters" })` reports the default mode capabilities plus optional mode metadata:

```json
{
  "agent_kind": "opencode",
  "supports_steering": true,
  "supports_attach": true,
  "supports_model_selection": true,
  "default_mode": "interactive",
  "supported_modes": ["interactive", "batch"]
}
```

`AdapterCapabilitiesSchema` should add:

```ts
default_mode?: AdapterRunMode;
supported_modes?: AdapterRunMode[];
```

These fields are descriptive and backward-compatible.

### Task status

`status(task_id)` must reflect the actual persisted task mode, not just the adapter default.

Interactive task:

```json
{
  "supports_steering": true,
  "supports_attach": true,
  "metadata": { "adapter_mode": "interactive" }
}
```

Batch task:

```json
{
  "supports_steering": false,
  "supports_attach": true,
  "metadata": { "adapter_mode": "batch" }
}
```

### Steering

`steer_task` must reject batch tasks with `steering_unsupported` even when the adapter's default mode supports steering.

## Shared implementation shape

Add helpers to `packages/adapters/src/adapter-options.ts`:

```ts
export type AdapterRunMode = "interactive" | "batch";

export function adapterRunModeFor(spec: TaskSpec): AdapterRunMode {
  return spec.adapter_options?.mode === "batch" ? "batch" : "interactive";
}

export function supportsSteeringForMode(mode: AdapterRunMode): boolean {
  return mode === "interactive";
}
```

Because `TaskSpec` is persisted in `tasks.spec_json`, `createPaneAdapter.status()` and `createPaneAdapter.steer()` can parse the task spec and derive the actual mode without changing the store schema.

The shared pane adapter should include `metadata.adapter_mode` in status views for every pane-backed adapter.

## Adapter-specific notes

### pi

`pi --help` confirms:

- interactive with initial prompt: `pi "prompt"`
- non-interactive: `pi -p "prompt"`
- model selection exists via `--model`, but that can be a separate improvement if desired.

Initial run-mode work should only add `mode` support and avoid expanding scope.

### jcode

Existing interactive mode remains `jcode repl` through the FIFO feeder. Batch mode should use:

```sh
jcode run [--model '<model>'] [--provider-profile '<profile>'] '<prompt>'
```

Batch mode should not claim steering support.

### opencode

`opencode run` should become batch mode. The default `opencode` adapter should use the normal TUI entrypoint:

```sh
opencode [--model '<model>'] --prompt '<prompt>'
```

`--dangerously-skip-permissions` is available on `opencode run` but not on the top-level TUI help output. Therefore permission bypass should apply only in batch mode unless a TUI-safe equivalent is verified.

### claude-code

Keep interactive behavior as default. Batch mode should be implemented only after verifying the installed `claude` CLI supports `-p` or `--print` for non-interactive execution.

## Documentation updates

Update:

- `README.md` adapter examples
- `docs/guides/project-config.md` adapter options examples
- `docs/issues/cuekit-opencode-run-positional-prompt.md` to clarify it applies to `opencode` batch mode
- `docs/issues/cuekit-adapter-permission-bypass-design.md` to clarify OpenCode permission bypass is batch/run-specific
- adapter smoke docs for `jcode` and future `opencode` TUI mode

## Test plan

Common tests:

- default mode is interactive when `adapter_options.mode` is omitted.
- invalid mode falls back to interactive.
- `adapter_options.mode: "batch"` is reflected in task status metadata.
- batch task status returns `supports_steering: false`.
- `steer_task` against a batch task returns `steering_unsupported`.

Adapter tests:

- `pi` interactive command uses `pi '<prompt>'`.
- `pi` batch command uses `pi -p '<prompt>'`.
- `jcode` interactive command remains FIFO `jcode repl`.
- `jcode` batch command uses `jcode run` and keeps provider profile/model flags.
- `opencode` interactive command uses TUI `opencode --prompt '<prompt>'`.
- `opencode` batch command preserves existing `opencode run -- '<prompt>'` behavior.
- `opencode` permission bypass appears only in batch command.

## Open questions

1. Should `mode: "non-interactive"` be accepted as an alias for `batch`? Recommendation: not initially; keep the public surface small.
2. Should `supports_attach` be false for batch mode? Recommendation: keep true for pane-backed batch commands because the streaming pane/transcript are still useful.
3. Should `mode` be promoted from `adapter_options` to top-level `TaskSpec` later? Recommendation: only if multiple non-pane adapters need it; `adapter_options` is enough now.
