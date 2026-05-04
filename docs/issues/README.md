# cuekit Issues / Investigation Notes

This directory contains focused investigations, bug reports, and historical notes created during active cuekit development. For the top-level documentation map, see [`../README.md`](../README.md).

Stable feature/subsystem design notes live in [`../designs/`](../designs/README.md). Keep `docs/issues/` for material that is still being investigated, is bug-specific, or has not been promoted into a stable design note or ADR.

## Active / Historical Investigations and Bug Reports

- [`cuekit-parent-wait-polling-design.md`](cuekit-parent-wait-polling-design.md) — parent-side polling/wait API design note with historical context.
- [`cuekit-delete-session-tmux-leak.md`](cuekit-delete-session-tmux-leak.md) — tmux cleanup bug report and fix context.
- [`cuekit-opencode-run-positional-prompt.md`](cuekit-opencode-run-positional-prompt.md) — OpenCode `run` prompt positional argument bug note.

## Promoted Design Notes

The following feature/subsystem designs were promoted to [`../designs/`](../designs/README.md):

- [`cuekit-agent-profiles-design.md`](../designs/cuekit-agent-profiles-design.md) — agent profile framework for role-based task submission and automatic role selection.
- [`cuekit-project-config-design.md`](../designs/cuekit-project-config-design.md) — `.cuekit.yaml` project identity and defaults configuration.
- [`cuekit-task-teams-design.md`](../designs/cuekit-task-teams-design.md) — lightweight session-scoped task teams for multi-task coding workflows.
- [`cuekit-team-strategies-design.md`](../designs/cuekit-team-strategies-design.md) — project-local strategy profiles that guide coordinator-led teams without becoming rigid workflows.
- [`cuekit-adapter-permission-bypass-design.md`](../designs/cuekit-adapter-permission-bypass-design.md) — default permission bypass behavior for unattended child agents.
- [`cuekit-adapter-run-modes-design.md`](../designs/cuekit-adapter-run-modes-design.md) — shared interactive/default and batch/non-interactive adapter mode design.
- [`cuekit-jcode-repl-adapter-design.md`](../designs/cuekit-jcode-repl-adapter-design.md) — `jcode repl` adapter design for tmux attach and steering support.
- [`cuekit-tui-task-cockpit-design.md`](../designs/cuekit-tui-task-cockpit-design.md) — OpenTUI-based human task cockpit for browsing tasks and managing operations.
- [`cuekit-tui-package-separation-design.md`](../designs/cuekit-tui-package-separation-design.md) — refactor design for moving TUI code into `@cuekit/tui`.

## When to Add Here

Add a document here when the work is an investigation, bug report, or focused design note that is not stable enough to be an ADR, not ready to be promoted to `docs/designs/`, and not broad enough to be a spec.

When an issue note becomes the stable reference for an implemented feature area, move it to `docs/designs/` and leave this index pointing to the promoted location.
