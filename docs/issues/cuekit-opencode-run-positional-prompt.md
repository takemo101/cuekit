# Bug: OpenCode batch mode must pass prompt as positional `run` message

## Problem

OpenCode batch mode uses `opencode run`. An earlier OpenCode adapter shape used `opencode run --prompt '<prompt>'`. Current OpenCode `run` accepts the prompt as positional `message..`; using `--prompt` prints help and exits with code 1.

The default `opencode` adapter mode is now the interactive TUI entrypoint (`opencode --prompt '<prompt>'`). This note applies only to `adapter_options.mode: "batch"`, where cuekit intentionally uses `opencode run`.

## Evidence

```bash
opencode run --dangerously-skip-permissions --prompt 'hi'
# exit 1, help output

opencode run --dangerously-skip-permissions 'hi'
# exit 0
```

## Fix

For batch mode, generate:

```bash
opencode run --dangerously-skip-permissions -- '<rendered prompt>'
```

and with a model:

```bash
opencode run --dangerously-skip-permissions --model '<model>' -- '<rendered prompt>'
```

`dangerously_skip_permissions: false` still removes the bypass flag.
