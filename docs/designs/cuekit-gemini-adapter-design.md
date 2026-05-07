# Design: gemini CLI adapter

## Problem

cuekit currently has tmux-pane adapters for `claude-code`, `opencode`, `pi`, and `jcode`. Adding a `gemini` adapter (Google Gemini CLI) lets parents delegate child work to a fourth coding agent runtime without changing the cuekit surface. We want all of cuekit's existing adapter UX:

- parents can attach to the live child pane with tmux;
- parents can steer interactive children with `steer_task`;
- parents can opt into a `batch` run mode for short single-shot prompts;
- child output is captured in the normal cuekit transcript path and exit-code sentinel;
- terminal status inference works the same way as for the other pane adapters;
- permission-bypass behaves consistently with the existing `dangerously_skip_permissions` semantics.

## Relevant Gemini CLI shape

Observed from local `gemini --help` (Gemini CLI):

```
gemini [options] [query..]            # default subcommand: launches Gemini CLI
gemini mcp                            # MCP server management (out of scope)
gemini extensions / skills / hooks    # extension management (out of scope)
gemini gemma                          # local Gemma routing (out of scope)

# global flags relevant to cuekit:
-m, --model <model>                   # model selection
-p, --prompt <text>                   # non-interactive (headless) mode
-y, --yolo                            # auto-approve all tools (permission bypass)
    --approval-mode <mode>            # default | auto_edit | yolo | plan
-o, --output-format <fmt>             # text | json | stream-json
    --acp                             # Agent Communication Protocol mode (out of scope for v0)
    --skip-trust                      # trust the workspace for this session
    --session-id <uuid>               # start a new session with manual UUID
-r, --resume <id|"latest">            # resume a previous session
```

Key facts:

- The CLI **defaults to interactive** when invoked with a positional query; `-p`/`--prompt` switches to a single-shot non-interactive run.
- `-y` / `--approval-mode yolo` is the permission-bypass equivalent of `claude --dangerously-skip-permissions` and `opencode --dangerously-skip-permissions`.
- `--output-format json` and `stream-json` exist for structured output, useful for future `result.json` / `task_events` projection but **not required** for v0.

## Decision

Implement `createGeminiAdapter` as a normal `createPaneAdapter` consumer, supporting both run modes from day one because the CLI exposes them first-class:

| Run mode | Launch shape |
|---|---|
| `interactive` (default) | `gemini [-y] [-m '<model>'] '<rendered prompt>'` (positional) |
| `batch` | `gemini [-y] [-m '<model>'] -p '<rendered prompt>'` |

`-y` is added by default (bypass enabled), matching `shouldDangerouslySkipPermissions` semantics shared with `claude-code` and `opencode`. Callers explicitly opt out with `adapter_options.dangerously_skip_permissions: false`. When opted out, the adapter omits `-y` and lets Gemini's default approval prompts drive — that path will stall an unattended pane, so the opt-out is intentionally only for trusted local sessions or when a human is ready to attach.

The launch command must still go through `wrapLaunchCommandWithExitCode` (shared by all pane adapters) so terminal status inference and exit-code sentinel handling work the same way as `claude-code`.

## Capabilities

```ts
{
  agent_kind: "gemini",
  supports_steering: true,
  supports_attach: true,
  supports_model_selection: true,
  supports_artifacts: true,
  supports_live_progress: false,
  default_mode: "interactive",
  supported_modes: ["interactive", "batch"],
}
```

Per the [adapter run-modes design](cuekit-adapter-run-modes-design.md), the `task status` view for a batch task must report `supports_steering: false` and `steer_task` must reject batch tasks with `steering_unsupported`. This is already handled by the shared pane adapter when `supported_modes` is wired correctly, so no Gemini-specific code is needed for that branch.

## Launch command details

A pure builder lives in `packages/adapters/src/gemini-adapter.ts`:

```ts
export function buildGeminiLaunchCommand(
  spec: TaskSpec,
  options: { geminiBin?: string } = {},
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
```

Implementation must ensure:

- the rendered prompt is shell-quoted (a prompt starting with `-` must not be parsed as an option — the `-p` form passes the prompt as the value, and the positional form is unambiguous because it follows other flags);
- model values are shell-quoted;
- the command runs under the shared `wrapLaunchCommandWithExitCode`;
- `--skip-trust` is added unconditionally so unattended panes never stall on the trusted-folder prompt (see "Trusted-folder handling" below);
- `-y` is added by default, removable only via explicit `dangerously_skip_permissions: false`;
- batch tasks are advertised with `supports_steering: false` via the shared run-mode capability projection;
- nothing in the adapter assumes Gemini-specific session paths in `~/` until verified during implementation (unlike `jcode`, which had a known `~/.jcode/active_pids/` cleanup requirement).

## Trusted-folder handling

Gemini CLI gates execution on a per-directory trust check. In an untrusted directory it prints:

> Gemini CLI is not running in a trusted directory. To proceed, either use `--skip-trust`, set the `GEMINI_CLI_TRUST_WORKSPACE=true` environment variable, or trust this directory in interactive mode.

This affects **both interactive and batch modes** — unlike Claude Code, Gemini does not auto-skip trust when stdout is non-TTY. Without an opt-out, an unattended cuekit pane will hang on the gate.

The adapter therefore always passes `--skip-trust`. This mirrors the rationale for `-y` being on by default (see [adapter permission bypass design](cuekit-adapter-permission-bypass-design.md)): cuekit's invariant is that delegated panes must make progress without prompts, so all sources of stalling are removed at submit time. There is no `dangerously_skip_permissions: false` style opt-out for the trust flag — if a caller wants the trust check to apply, they should not be using cuekit's unattended pane delegation in the first place.

`GEMINI_CLI_TRUST_WORKSPACE=true` via env is an equivalent path but is rejected in favor of the explicit flag because (a) flag presence is visible in the captured transcript and `tmux` inspection, (b) env var injection is slightly more invasive on the pane shell. Implementation may revisit this if a future Gemini CLI version drops the flag.

### Comparison: claude-code

Claude Code has **no `--skip-trust` flag** (verified against `claude --help` flag set). Its trust dialog is auto-skipped only when running in non-interactive `-p` mode or with non-TTY stdout. In cuekit's interactive pane the dialog *would* appear in untrusted directories, but in practice users have already trusted the directory through their host-side `claude` usage and the trust state in `~/.claude/` is shared with the cuekit-spawned child.

The claude-code adapter is therefore **left unchanged** in this design. If a real cuekit user hits the dialog in an unfamiliar directory, the right fix is documentation in `cuekit doctor` ("trust this directory once with normal `claude` first"), not adapter-level trust bypass — there is no flag to add, and writing to `~/.claude/` from cuekit would silently expand the trust scope behind the user's back.

## Steering contract

Interactive mode runs Gemini's normal REPL on a TTY in the tmux pane, so `steer_task` works the same way as for `claude-code` and `opencode`: cuekit calls `tmux send-keys` to deliver the message and a literal `C-m` newline.

Implementation must verify in a real-runtime smoke test that:

1. `tmux send-keys` reliably appends a message to a running interactive Gemini REPL prompt;
2. Gemini's prompt does not eat or echo the trailing newline in a way that breaks subsequent steering;
3. transitioning between Gemini's busy state and prompt-ready state does not require a special keystroke (e.g. `Esc`) before send-keys.

If (3) turns out to be necessary, follow the same pattern `opencode` uses (a small pre-key sequence before the message), not a Gemini-specific bespoke path.

## Auth and setup

Gemini CLI typically requires either:

- an interactive `gemini auth` / browser-based login for the free tier, or
- a `GEMINI_API_KEY` (or equivalent env var) for headless / batch runs.

This is **out of adapter scope** — the adapter assumes the binary is already authenticated. `cuekit doctor` should:

- detect the `gemini` binary on `PATH`;
- run a cheap auth probe (e.g. `gemini --version` or a documented status command) and surface a clear hint when auth is missing;
- not attempt to write or refresh credentials itself.

The auth probe is added in the same PR as the adapter so `cuekit doctor` output is useful out of the box, but the adapter does not block submission on missing auth — Gemini's own error messages surface in the captured transcript.

## Files to change in implementation

Expected files:

- Create `packages/adapters/src/gemini-adapter.ts`.
- Export `createGeminiAdapter` and `buildGeminiLaunchCommand` from `packages/adapters/src/index.ts`.
- Register the adapter in MCP wiring alongside `claude-code`, `opencode`, `pi`, and `jcode`.
- Add `gemini` to the `agent_kind` union in `@cuekit/core` (Zod schema + types).
- Add `packages/adapters/__tests__/gemini-adapter.test.ts` for build/launch and capability shape.
- Update MCP / stdio integration tests that assert adapter list length or exact agent kinds.
- Update the `gemini` row in the [adapter run-modes design](cuekit-adapter-run-modes-design.md) command matrix.
- Update README and AGENTS.md adapter lists.
- Add a `cuekit doctor` Gemini probe.

## Test plan

Adapter-level tests:

- `createGeminiAdapter(...).capabilities()` returns `agent_kind: "gemini"`, `supports_attach: true`, `supports_steering: true`, `supports_model_selection: true`, `default_mode: "interactive"`, `supported_modes: ["interactive", "batch"]`.
- `buildGeminiLaunchCommand({ agent_kind: "gemini", objective: "x" })` defaults to `gemini --skip-trust -y '<prompt>'`.
- `--skip-trust` is always present, including when `dangerously_skip_permissions: false` is set (the trust flag is not gated by the permissions option).
- Adding `model: "gemini-2.5-flash"` produces `gemini --skip-trust -y -m 'gemini-2.5-flash' '<prompt>'`.
- Adding `adapter_options.mode: "batch"` produces `gemini --skip-trust -y -m '<model>' -p '<prompt>'`.
- Adding `adapter_options.dangerously_skip_permissions: false` omits `-y` but keeps `--skip-trust`.
- Prompts starting with `-` and prompts containing single quotes are correctly shell-quoted.
- Submit → status returns a running view with tmux `attach_hint` under the fake pane backend.
- `steer()` sends keys to the tmux pane when the task is interactive and running; rejects with `steering_unsupported` when `metadata.adapter_mode: "batch"`.

MCP-level tests:

- `list({ kind: "adapters" })` includes `gemini` and reports the new run-mode capability fields.
- `submit_task` accepts `agent_kind: "gemini"` in the fake-backed test harness.
- Stdio integration adapter count / expected agent kinds are updated.

Validation:

```sh
bun test packages/adapters
bun test packages/mcp
bun run typecheck
bun run check
bun test
```

A real-runtime smoke test (similar to the one for `jcode repl` in [`docs/guides/jcode-adapter.md`](../guides/jcode-adapter.md)) must cover:

- submit a task with `--agent_kind gemini --model <known model>`;
- `tmux attach-session -t cuekit-task-<id>` shows the live REPL;
- `cuekit task steer ...` reaches the running child;
- transcript appears at `<cwd>/.cuekit/tasks/<task_id>/transcript.txt`;
- `cancel_tasks` cleans up the tmux session;
- batch mode (`adapter_options: '{"mode":"batch"}'`) returns `supports_steering: false` in `task status`, and `steer_task` rejects with `steering_unsupported`.

Add the smoke recipe to `docs/guides/gemini-adapter.md` once the adapter ships.

## Safety notes

- `-y` (yolo) approves every tool call, including potentially destructive ones. The default-on choice mirrors `claude-code`'s and `opencode`'s existing v0 behavior, where unattended panes need to make progress without prompts. Project config (`.cuekit.yaml`) keeps the right to force `dangerously_skip_permissions: false` for prompt-safe defaults — this still applies to the Gemini adapter unchanged.
- `--approval-mode plan` (read-only) and `--approval-mode auto_edit` are interesting future toggles, but v0 keeps the binary `-y` / no-`-y` mapping to align with existing adapters and avoid expanding the shared `adapter_options` shape mid-prototype.

## Open questions

1. **Advertised models**: should `availableModels` default to a curated list (`gemini-2.5-pro`, `gemini-2.5-flash`, ...) the way `claude-code` does (`haiku/sonnet/opus`)? Pick the names the CLI itself accepts; do not invent aliases. Confirm during implementation by listing the CLI's supported model strings.
2. **Structured `result.json`**: should the batch path also write `gemini -p --output-format json` stdout into `<worktree>/.cuekit/tasks/<task_id>/result.json` for cleaner result normalization? Defer to a follow-up because the same improvement applies symmetrically to other adapters and should not be built one-off here.
3. **`--acp` mode**: Gemini CLI supports the Agent Communication Protocol natively. This is conceptually closer to cuekit than tmux pane I/O, but v0 keeps every adapter on the shared pane backend. Reconsider only if `--acp` becomes a clearly better steering channel than `tmux send-keys` for at least one shipped runtime.
4. **`--session-id` / `--resume`**: useful for cross-task continuity (resume a parent's prior child session). Not needed for v0 — defer until a feature explicitly asks for it.
5. **Doctor auth probe shape**: which command does `cuekit doctor` invoke to detect missing auth without side effects? Pick during implementation; if no clean probe exists, settle for binary detection plus a documentation hint.
