# cuekit Design Notes

This directory contains feature and subsystem design notes that are stable enough to use as implementation reference, but are not broad protocol specs or durable ADRs.

Use these notes when working on an existing cuekit feature area. For current open investigations and bug reports, see [`../issues/README.md`](../issues/README.md). For high-level product/protocol specs, see [`../specs/README.md`](../specs/README.md). For architecture constraints, see [`../architecture/README.md`](../architecture/README.md).

## Feature and Subsystem Designs

- [`cuekit-agent-profiles-design.md`](cuekit-agent-profiles-design.md) — agent profile framework for role-based task submission and automatic role selection.
- [`cuekit-project-config-design.md`](cuekit-project-config-design.md) — `.cuekit.yaml` project identity, defaults, scopes, and safety rules.
- [`cuekit-pr-finisher-profile-design.md`](cuekit-pr-finisher-profile-design.md) — builtin `pr-finisher` agent profile and strategy slot convention for safe PR creation, merge, sync, and cleanup.
- [`cuekit-task-teams-design.md`](cuekit-task-teams-design.md) — lightweight session-scoped task teams for multi-task coding workflows.
- [`cuekit-team-strategies-design.md`](cuekit-team-strategies-design.md) — project-local strategy profiles that guide coordinator-led teams without becoming rigid workflows.
- [`cuekit-task-observability-design.md`](cuekit-task-observability-design.md) — minimal task event payloads for child file self-reporting, diagnostics, and team stale-read warnings.
- [`cuekit-adapter-permission-bypass-design.md`](cuekit-adapter-permission-bypass-design.md) — default permission bypass behavior for unattended child agents.
- [`cuekit-adapter-run-modes-design.md`](cuekit-adapter-run-modes-design.md) — shared interactive/default and batch/non-interactive adapter mode design.
- [`cuekit-jcode-repl-adapter-design.md`](cuekit-jcode-repl-adapter-design.md) — `jcode repl` adapter design for tmux attach and steering support.
- [`cuekit-tui-task-cockpit-design.md`](cuekit-tui-task-cockpit-design.md) — OpenTUI-based human task cockpit for browsing tasks and managing operations.
- [`cuekit-tui-package-separation-design.md`](cuekit-tui-package-separation-design.md) — package-boundary design for moving TUI code into `@cuekit/tui`.

## When to Add Here

Add a document here when a design has become a stable reference for an implemented or actively maintained feature area.

Do not add temporary bug reports, one-off investigations, implementation checklists, or ADR-level decisions here:

- Bug reports and active investigations belong in [`../issues/`](../issues/README.md).
- Step-by-step implementation plans belong in [`../plans/`](../plans/).
- Durable decisions with long-term constraints belong in [`../decisions/`](../decisions/).
