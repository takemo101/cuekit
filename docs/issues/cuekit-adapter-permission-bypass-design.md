# Design: default permission bypass for claude-code and opencode adapters

## Background

`claude-code` and `opencode` tasks run inside cuekit-managed tmux panes. Both runtimes can stop at permission prompts, leaving the parent orchestrator with a running task that needs manual intervention.

Both CLIs expose an explicit dangerous bypass flag for the modes cuekit uses for unattended work:

- Claude Code: `--dangerously-skip-permissions`
- OpenCode batch mode: `opencode run --dangerously-skip-permissions`

OpenCode's top-level TUI help does not advertise `--dangerously-skip-permissions`, so cuekit applies OpenCode permission bypass only when `adapter_options.mode: "batch"` selects `opencode run`.

## Goal

Enable permission bypass by default for delegated `claude-code` and `opencode` panes so unattended child agents do not stall on runtime permission prompts.

Allow parent callers to opt out per task via `TaskSpec.adapter_options.dangerously_skip_permissions: false`.

## Non-goals

- Changing pi adapter behavior
- Broad permission policy modeling
- Suppressing non-permission interactive prompts

## API

Default behavior requires no option:

```json
{
  "agent_kind": "claude-code",
  "objective": "..."
}
```

Opt out per task:

```json
{
  "agent_kind": "claude-code",
  "objective": "...",
  "adapter_options": {
    "dangerously_skip_permissions": false
  }
}
```

Only the boolean literal `false` disables the flag. Missing, `true`, strings, or other values keep the default enabled behavior.

## Adapter behavior

### Claude Code

Default:

```sh
claude --dangerously-skip-permissions --model 'sonnet' '<prompt>'
```

Opt-out:

```sh
claude --model 'sonnet' '<prompt>'
```

### OpenCode batch mode

Default with `adapter_options.mode: "batch"`:

```sh
opencode run --dangerously-skip-permissions --model 'provider/model' -- '<prompt>'
```

Opt-out:

```sh
opencode run --model 'provider/model' -- '<prompt>'
```

## Safety

This default is intentionally optimized for delegated unattended child agents. It should be used in trusted/sandboxed worktrees because it allows the child runtime to auto-approve permissions that would otherwise require review.

Callers that want runtime permission prompts must pass `adapter_options.dangerously_skip_permissions: false`.

## Testing

- Claude builder includes the flag by default
- Claude builder includes the flag for explicit `true`
- Claude builder omits the flag for explicit `false`
- OpenCode builder includes the flag by default
- OpenCode builder includes the flag for explicit `true`
- OpenCode builder omits the flag for explicit `false`
