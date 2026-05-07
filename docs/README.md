# cuekit Documentation

Starting point for agents and humans working on cuekit. Each subdirectory has its own index — this page only routes you to the right one.

## Map

| Directory | Role |
|---|---|
| [`specs/`](specs/README.md) | **What cuekit is.** Protocol, state model, MCP API, adapter contract, scope. |
| [`architecture/`](architecture/README.md) | **How cuekit must be built.** Package boundaries, coding rules, error handling, workflow. |
| [`decisions/`](decisions/) | ADRs and durable design decisions. |
| [`designs/`](designs/README.md) | Stable feature/subsystem designs (teams, strategies, profiles, adapters, TUI, ...). |
| [`guides/`](guides/README.md) | Operator/developer usage docs for implemented features. |
| [`issues/`](issues/README.md) | Active investigations and bug reports not yet promoted to designs/ADRs. |
| [`plans/`](plans/) | Implementation plans and execution notes. |
| [`references/`](references/README.md) | Local copies of third-party docs used during implementation. |

## Reading order

For the shortest path to understanding the project:

1. [`specs/README.md`](specs/README.md) — what cuekit is.
2. [`architecture/README.md`](architecture/README.md) — how it must be built.
3. [`decisions/`](decisions/) — durable decisions you must respect.
4. [`designs/README.md`](designs/README.md) — feature-level designs for the area you're touching.
5. [`guides/README.md`](guides/README.md) — end-user docs for that feature, if it has shipped.

## Before implementing a new feature

1. Read the relevant specs and architecture docs.
2. Check `decisions/`, `designs/`, and `issues/` for recent decisions and feature-specific constraints.
3. If the feature depends on a library/tool, check `references/`.
4. Add or update a focused design note when work changes behavior or introduces a new surface.

## Where new docs go

- **Spec-level** change to protocol/state/MCP/adapter shape → `specs/`.
- **Architecture-level** change to package boundaries, error rules, or build order → `architecture/`.
- **Durable decision** with long-term constraints → `decisions/` (ADR).
- **Stable feature design** for an implemented or actively maintained area → `designs/`.
- **Active investigation or bug report** not yet stable → `issues/`.
- **Step-by-step implementation plan** → `plans/`.
- **Operator/developer how-to** for a shipped feature → `guides/`.
- **Third-party reference material** → `references/`.

When an `issues/` note becomes the stable reference for an implemented feature, promote it to `designs/`.
