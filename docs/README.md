# cuekit Documentation Index

This index is the starting point for agents and humans working on cuekit.

## Start Here

1. [Specs](specs/README.md) — what cuekit is: protocol, state model, MCP API, adapters, scope.
2. [Architecture](architecture/README.md) — how cuekit must be built: package boundaries, coding rules, error handling, workflow.
3. [Decisions](decisions/001-child-reporting-surface.md) — durable design decisions and ADRs.
4. [Completed Features](#completed-features) — stable design notes and guides for Agent Profiles and TUI.

## Completed Features

Stable documentation and design notes for completed features:

- [Agent profiles design](issues/cuekit-agent-profiles-design.md) — role-based task submission framework
- [Agent profiles guide](guides/agent-profiles.md) — end-user documentation and usage examples
- [Project config guide](guides/project-config.md) — `.cuekit.yaml` identity, defaults, scopes, and safety rules
- [jcode adapter guide](guides/jcode-adapter.md) — real-runtime smoke test for the `jcode repl` tmux adapter
- [TUI task cockpit design](issues/cuekit-tui-task-cockpit-design.md) — human-facing OpenTUI interface
- [TUI package separation design](issues/cuekit-tui-package-separation-design.md) — implementation architecture

## Feature / Investigation Notes

Additional focused design notes, bug reports, and investigations live under [issues](issues/README.md):

- [Child reporting ADR](decisions/001-child-reporting-surface.md)
- [Parent wait/polling design](issues/cuekit-parent-wait-polling-design.md)
- [Adapter permission bypass design](issues/cuekit-adapter-permission-bypass-design.md)
- [OpenCode positional prompt fix](issues/cuekit-opencode-run-positional-prompt.md)
- [tmux cleanup bug report](issues/cuekit-delete-session-tmux-leak.md)

## External / Local References

Local copies of third-party references used for implementation live under [references](references/README.md).

Current references:

- [OpenTUI](references/opentui/README.md) — read before designing or implementing `cuekit tui`.

## Documentation Roles

**Current documentation:**

- `docs/specs/` — stable project/product design.
- `docs/architecture/` — implementation constraints and rules.
- `docs/decisions/` — ADRs and durable design decisions.
- `docs/issues/` — active focused investigations, bug reports, and design notes; also completed feature documentation.
- `docs/plans/` — implementation plans for features currently under development.
- `docs/references/` — local reference material for dependencies/tools.
- `docs/guides/` — operator/developer feature guides.

## Rule of Thumb

Before implementing a new feature:

1. Read the relevant specs and architecture docs.
2. Check `docs/decisions/` and `docs/issues/` for recent decisions.
3. If the feature depends on a library/tool, check `docs/references/`.
4. Add a focused design note when the work changes behavior or introduces a new surface.

