# Design: jcode REPL adapter

## Problem

cuekit currently has tmux-pane adapters for Claude Code, OpenCode, and pi. We want to add `jcode` as another child runtime while preserving the key cuekit UX:

- parent agents can attach to the live child pane with tmux;
- parent agents can steer the running child with `steer_task`;
- child output is captured in the normal cuekit transcript path;
- child tasks still receive cuekit's child reporting contract.

The obvious command, `jcode run <message>`, is non-interactive: it streams one request and exits. That is useful for a simple submit/result adapter, but it does not match the Claude Code / OpenCode live-pane workflow because follow-up steering cannot reliably become additional input to the running agent.

## Relevant jcode CLI shape

Observed from local `jcode --help`:

```sh
jcode run [OPTIONS] <MESSAGE>
jcode repl [OPTIONS]

# global / subcommand options include:
-C, --cwd <CWD>
-m, --model <MODEL>
--provider-profile <PROVIDER_PROFILE>
--no-update
```

`jcode run` is documented as “Run a single message and exit”. `jcode repl` is documented as “Run in simple REPL mode (no TUI)”.

## Decision

Implement the first `jcode` cuekit adapter using `jcode repl`, not `jcode run`.

The launch command should run inside cuekit's existing tmux pane backend and pipe the initial rendered task prompt into the REPL, then keep stdin connected for later steering:

```sh
(printf '%s\n' '<rendered task prompt>'; cat) | jcode repl --no-update [-m '<model>']
```

The adapter should be a normal `createPaneAdapter` consumer.

Proposed capabilities:

```ts
{
  agent_kind: "jcode",
  supports_steering: true,
  supports_attach: true,
  supports_model_selection: true,
  supports_artifacts: true,
  supports_live_progress: false,
}
```

Model selection is enabled because `jcode repl --help` exposes `-m, --model <MODEL>`.

## Why not `jcode run`?

`jcode run` remains a possible future “batch” mode, but it should not be the default adapter mode because it is explicitly single-shot. In cuekit terms:

- attach would show a streaming command, but not a persistent interactive session;
- `steer_task` would send keys to a pane whose process may ignore stdin or already be exiting;
- the child would be less similar to Claude Code / OpenCode tasks, where the parent can observe and steer a live runtime.

`jcode repl` better matches cuekit's current adapter semantics.

## Launch command details

A pure builder should live in `packages/adapters/src/jcode-adapter.ts`:

```ts
export function buildJcodeReplLaunchCommand(spec: TaskSpec, jcodeBin = "jcode"): string {
  const parts = [jcodeBin, "repl", "--no-update"];
  if (spec.model) parts.push("--model", shellQuote(spec.model));
  return `(printf '%s\\n' ${shellQuote(renderTaskSpecPrompt(spec))}; cat) | ${parts.join(" ")}`;
}
```

Implementation should ensure:

- the rendered prompt is shell-quoted;
- model values are shell-quoted;
- a prompt starting with `-` is treated as text, not an option;
- `cat` keeps the pipeline alive for subsequent `tmux send-keys` steering;
- the command still runs under `wrapLaunchCommandWithExitCode` from the shared pane adapter, so normal terminal status inference still works.

## Safety and permissions

jcode does not expose an obvious equivalent to Claude Code / OpenCode `--dangerously-skip-permissions` in the observed help output. Therefore the first adapter should ignore `adapter_options.dangerously_skip_permissions` and should not advertise permission bypass behavior.

Project config may still select `agent_kind: jcode` as a safe adapter default. Permission-bypass docs should not imply jcode participates in bypass semantics unless a jcode-specific option is verified later.

## Files to change in implementation

Expected implementation files:

- Create `packages/adapters/src/jcode-adapter.ts`.
- Export it from `packages/adapters/src/index.ts`.
- Register it in the MCP adapter registry wiring alongside Claude Code, OpenCode, and pi.
- Add adapter tests in `packages/adapters/__tests__/stub-adapters.test.ts` or a dedicated `jcode-adapter.test.ts`.
- Update MCP command / stdio tests that assert adapter list length or exact agent kinds.
- Update docs / README adapter lists.

## Test plan

Adapter-level tests:

- `createJcodeAdapter(...).capabilities()` returns `agent_kind: "jcode"`, `supports_attach: true`, `supports_steering: true`, `supports_model_selection: true`.
- `buildJcodeReplLaunchCommand({ agent_kind: "jcode", objective: "x" })` uses `jcode repl --no-update` and the `(printf ...; cat) | ...` shape.
- Model names are shell-quoted.
- Rendered prompts are shell-quoted and include full `TaskSpec` guidance.
- Submit → status returns a running view with tmux `attach_hint` under the fake pane backend.
- `steer()` sends keys to the tmux pane when the task is running.

MCP-level tests:

- `list({ kind: "adapters" })` includes `jcode`.
- `submit_task` accepts `agent_kind: "jcode"` in the fake-backed test harness.
- Stdio integration adapter count / expected agent kinds are updated.

Validation:

```sh
bun test packages/adapters
bun test packages/mcp
bun run typecheck
bun run check
bun test
```

## Open questions

1. Should the adapter accept a `provider_profile` adapter option and translate it to `--provider-profile`? This is useful, but can be added after the basic REPL adapter lands.
2. Should we support both modes later (`jcode` = repl, `jcode-run` = one-shot batch)? Not needed for the first implementation.
3. Does `jcode repl` reliably consume stdin from a pipe on all supported platforms? The fake backend can test command shape; a real tmux integration smoke should be used before declaring the adapter production-ready.
