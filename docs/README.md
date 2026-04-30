# cuekit Documentation Index

This index is the starting point for agents and humans working on cuekit.

## Start Here

1. [Specs](specs/README.md) — what cuekit is: protocol, state model, MCP API, adapters, scope.
2. [Architecture](architecture/README.md) — how cuekit must be built: package boundaries, coding rules, error handling, workflow.
3. [Decisions](decisions/001-child-reporting-surface.md) — durable design decisions and ADRs.
4. [Implementation Plan](plans/2026-04-23-cuekit-implementation-plan.md) — original implementation sequence.

## Feature / Investigation Notes

Operational findings, bug reports, and focused feature designs live under [issues](issues/README.md).

Important current notes:

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

- `docs/specs/` — stable project/product design.
- `docs/architecture/` — implementation constraints and rules.
- `docs/decisions/` — ADRs and durable decisions.
- `docs/issues/` — issue drafts, investigations, focused design notes.
- `docs/plans/` — implementation plans.
- `docs/references/` — local reference material for dependencies/tools.
- `docs/handoffs/` — handoff notes and historical context.

## Rule of Thumb

Before implementing a new feature:

1. Read the relevant specs and architecture docs.
2. Check `docs/decisions/` and `docs/issues/` for recent decisions.
3. If the feature depends on a library/tool, check `docs/references/`.
4. Add a focused design note when the work changes behavior or introduces a new surface.
