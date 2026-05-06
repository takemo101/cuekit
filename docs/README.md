# cuekit Documentation Index

This index is the starting point for agents and humans working on cuekit.

## Start Here

1. [Specs](specs/README.md) — what cuekit is: protocol, state model, MCP API, adapters, scope.
2. [Architecture](architecture/README.md) — how cuekit must be built: package boundaries, coding rules, error handling, workflow.
3. [Decisions](decisions/001-child-reporting-surface.md) — durable design decisions and ADRs.
4. [Design notes](designs/README.md) — stable feature/subsystem designs such as teams, strategies, profiles, adapters, and TUI.
5. [Guides](guides/) — operator/developer usage docs for implemented features.

## Current Feature References

Stable feature documentation and design notes:

- [Agent profiles design](designs/cuekit-agent-profiles-design.md) — role-based task submission framework.
- [Agent profiles guide](guides/agent-profiles.md) — end-user documentation and usage examples.
- [Project config design](designs/cuekit-project-config-design.md) — `.cuekit.yaml` design background.
- [PR finisher profile design](designs/cuekit-pr-finisher-profile-design.md) — builtin `pr-finisher` profile and first-class `position: finisher` strategy slot convention.
- [Coordinator notifications routing design](designs/cuekit-coordinator-notifications-routing-design.md) — guidance-first report-back routing built on `position: finisher`.
- [Team attention items design](designs/cuekit-team-attention-items-design.md) — derived important-event summaries before notification delivery or auto-wake.
- [Project config guide](guides/project-config.md) — `.cuekit.yaml` identity, defaults, scopes, and safety rules.
- [Task teams design](designs/cuekit-task-teams-design.md) — lightweight session-scoped teams.
- [Team strategies design](designs/cuekit-team-strategies-design.md) — coordinator strategy playbooks.
- [Task observability design](designs/cuekit-task-observability-design.md) — child file self-reporting, timeout diagnostics, and conservative team stale-read warnings.
- [Adapter run modes design](designs/cuekit-adapter-run-modes-design.md) — interactive/batch adapter behavior.
- [jcode adapter design](designs/cuekit-jcode-repl-adapter-design.md) and [guide](guides/jcode-adapter.md) — `jcode repl` tmux adapter.
- [TUI task cockpit design](designs/cuekit-tui-task-cockpit-design.md) — human-facing OpenTUI interface.
- [TUI package separation design](designs/cuekit-tui-package-separation-design.md) — implementation architecture.
- [Human CLI and distribution design](designs/cuekit-human-cli-distribution-design.md) — `@cuekit/cli`, `cuekit doctor`, and `cuekit update` design.

## Active / Historical Investigations

Focused bug reports and investigations live under [issues](issues/README.md). Current examples:

- [Parent wait/polling design](issues/cuekit-parent-wait-polling-design.md)
- [OpenCode positional prompt fix](issues/cuekit-opencode-run-positional-prompt.md)
- [tmux cleanup bug report](issues/cuekit-delete-session-tmux-leak.md)

## External / Local References

Local copies of third-party references used for implementation live under [references](references/README.md).

Current references:

- [OpenTUI](references/opentui/README.md) — read before designing or implementing `cuekit tui`.

## Documentation Roles

- `docs/specs/` — stable project/product design and protocol-level shape.
- `docs/architecture/` — implementation constraints, package boundaries, coding rules, and error handling.
- `docs/decisions/` — ADRs and durable design decisions.
- `docs/designs/` — stable feature/subsystem design notes used as implementation reference.
- `docs/issues/` — active investigations, bug reports, and historical notes not yet promoted to stable design/ADR.
- `docs/plans/` — implementation plans and historical execution notes.
- `docs/references/` — local reference material for dependencies/tools.
- `docs/guides/` — operator/developer feature guides.

## Rule of Thumb

Before implementing a new feature:

1. Read the relevant specs and architecture docs.
2. Check `docs/decisions/`, `docs/designs/`, and `docs/issues/` for recent decisions and feature-specific constraints.
3. If the feature depends on a library/tool, check `docs/references/`.
4. Add or update a focused design note when work changes behavior or introduces a new surface.
