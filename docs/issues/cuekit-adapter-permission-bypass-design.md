# Design: opt-in permission bypass for claude-code and opencode adapters

## Background

`claude-code` and `opencode` tasks run inside cuekit-managed tmux panes. Both runtimes can stop at permission prompts, leaving the parent orchestrator with a running task that needs manual intervention.

Both CLIs expose an explicit dangerous bypass flag:

- Claude Code: `--dangerously-skip-permissions`
- OpenCode: `opencode run --dangerously-skip-permissions`

## Goal

Allow parent callers to opt in per task via `TaskSpec.adapter_options.dangerously_skip_permissions`.

## Non-goals

- Enabling bypass by default
- Broad permission policy modeling
- Changing pi adapter behavior
- Suppressing non-permission interactive prompts

## API

```json
{
  "agent_kind": "claude-code",
  "objective": "...",
  "adapter_options": {
    "dangerously_skip_permissions": true
  }
}
```

Only the boolean literal `true` enables the flag. Missing, `false`, strings, or other truthy-looking values preserve the safe default.

## Adapter behavior

### Claude Code

Default:

```sh
claude --model 'sonnet' '<prompt>'
```

Opt-in:

```sh
claude --dangerously-skip-permissions --model 'sonnet' '<prompt>'
```

### OpenCode

Default:

```sh
opencode run --model 'provider/model' --prompt '<prompt>'
```

Opt-in:

```sh
opencode run --dangerously-skip-permissions --model 'provider/model' --prompt '<prompt>'
```

## Safety

This is intentionally task-scoped and opt-in. Callers should use it only in trusted/sandboxed worktrees because it allows the child runtime to auto-approve permissions that would otherwise require review.

## Testing

- Claude builder omits the flag by default
- Claude builder omits the flag for explicit `false`
- Claude builder includes the flag for explicit `true`
- OpenCode builder omits the flag by default
- OpenCode builder omits the flag for explicit `false`
- OpenCode builder includes the flag for explicit `true`
