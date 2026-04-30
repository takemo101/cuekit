# cuekit Issues / Investigation Notes

This directory contains two kinds of documents:

1. original GitHub issue drafts from the project scaffold phase.
2. focused investigation/design notes created while dogfooding cuekit.

For the top-level documentation map, see [`../README.md`](../README.md).

## Original Issue Drafts

These were written at GitHub-import granularity:

1. [`001-workspace-scaffold.md`](001-workspace-scaffold.md)
2. [`002-core-protocol.md`](002-core-protocol.md)
3. [`003-store-sqlite-state.md`](003-store-sqlite-state.md)
4. [`004-adapter-contract-and-first-spike.md`](004-adapter-contract-and-first-spike.md)
5. [`005-mcp-control-surface.md`](005-mcp-control-surface.md)
6. [`006-e2e-validation-and-docs.md`](006-e2e-validation-and-docs.md)

GitHub-ready copies also live under [`github/`](github/).

## Current Focused Notes

- [`cuekit-parent-wait-polling-design.md`](cuekit-parent-wait-polling-design.md) — parent-side polling/wait API; current MCP surface is `wait_tasks` only.
- [`cuekit-adapter-permission-bypass-design.md`](cuekit-adapter-permission-bypass-design.md) — default permission bypass behavior for unattended child agents.
- [`cuekit-opencode-run-positional-prompt.md`](cuekit-opencode-run-positional-prompt.md) — OpenCode `run` prompt must be positional and protected by `--`.
- [`cuekit-delete-session-tmux-leak.md`](cuekit-delete-session-tmux-leak.md) — tmux cleanup bug report and fix context.
- [`cuekit-tui-task-cockpit-design.md`](cuekit-tui-task-cockpit-design.md) — planned OpenTUI-based human task cockpit.
- [`cuekit-tui-package-separation-design.md`](cuekit-tui-package-separation-design.md) — refactor design for moving TUI code into `@cuekit/tui`.

## When to Add Here

Add a document here when the work is an investigation, bug report, or focused design note that is not stable enough to be an ADR and not broad enough to be a spec.
