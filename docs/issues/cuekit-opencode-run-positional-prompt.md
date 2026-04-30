# Bug: OpenCode adapter must pass prompt as positional `run` message

## Problem

The OpenCode adapter used `opencode run --prompt '<prompt>'`. Current OpenCode `run` accepts the prompt as positional `message..`; using `--prompt` prints help and exits with code 1.

## Evidence

```bash
opencode run --dangerously-skip-permissions --prompt 'hi'
# exit 1, help output

opencode run --dangerously-skip-permissions 'hi'
# exit 0
```

## Fix

Generate:

```bash
opencode run --dangerously-skip-permissions -- '<rendered prompt>'
```

and with a model:

```bash
opencode run --dangerously-skip-permissions --model '<model>' -- '<rendered prompt>'
```

`dangerously_skip_permissions: false` still removes the bypass flag.
