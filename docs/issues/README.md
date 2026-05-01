# cuekit Issues / Investigation Notes

This directory contains focused investigation/design notes created during active cuekit development. For the top-level documentation map, see [`../README.md`](../README.md).

## Completed Feature Design Notes

Stable design documentation for completed features:

- [`cuekit-agent-profiles-design.md`](cuekit-agent-profiles-design.md) — agent profile framework for role-based task submission and automatic role selection.
- [`cuekit-tui-task-cockpit-design.md`](cuekit-tui-task-cockpit-design.md) — OpenTUI-based human task cockpit for browsing tasks and managing operations.
- [`cuekit-tui-package-separation-design.md`](cuekit-tui-package-separation-design.md) — refactor design for moving TUI code into `@cuekit/tui`.

## Active Investigations and Bug Reports

Current focused work on outstanding issues:

- [`cuekit-parent-wait-polling-design.md`](cuekit-parent-wait-polling-design.md) — parent-side polling/wait API; current MCP surface is `wait_tasks` only.
- [`cuekit-adapter-permission-bypass-design.md`](cuekit-adapter-permission-bypass-design.md) — default permission bypass behavior for unattended child agents.
- [`cuekit-delete-session-tmux-leak.md`](cuekit-delete-session-tmux-leak.md) — tmux cleanup bug report and fix context.
- [`cuekit-opencode-run-positional-prompt.md`](cuekit-opencode-run-positional-prompt.md) — OpenCode `run` prompt must be positional and protected by `--`.
- [`cuekit-task-teams-design.md`](cuekit-task-teams-design.md) — lightweight session-scoped task teams for multi-task coding workflows.

## When to Add Here

Add a document here when the work is an investigation, bug report, or focused design note that is not stable enough to be an ADR and not broad enough to be a spec.

