# cuekit Specs Index

This directory contains the current design documents for cuekit.

## Reading Order

If you want the shortest path to understanding the project, read in this order:

1. [`2026-04-23-cuekit-design.md`](2026-04-23-cuekit-design.md)
   - High-level project definition
   - Scope, goals, non-goals
   - Core architecture position

2. [`2026-04-23-cuekit-protocol-spec.md`](2026-04-23-cuekit-protocol-spec.md)
   - Core delegation protocol
   - Task/session model
   - Status, result, error, capability concepts

3. [`2026-04-23-cuekit-state-model.md`](2026-04-23-cuekit-state-model.md)
   - Persistent state model
   - Session/task tables
   - Global DB + local output file strategy

4. [`2026-04-23-cuekit-mcp-api-spec.md`](2026-04-23-cuekit-mcp-api-spec.md)
   - MCP control surface
   - Tool request/response shapes

5. [`2026-04-23-cuekit-adapter-spec.md`](2026-04-23-cuekit-adapter-spec.md)
   - Runtime adapter responsibilities
   - Pi / Claude Code / OpenCode adapter expectations

6. [`2026-04-23-cuekit-related-work.md`](2026-04-23-cuekit-related-work.md)
   - A2A, MCP-A2A bridges, hive-mcp, ACP
   - Design boundary and implementation reference notes

## Architecture Rules

Implementation constraints and architectural rules live under [`../architecture/`](../architecture/README.md).

Read architecture docs when you need guidance on:

- dependency direction
- package boundaries
- naming constraints
- implementation order
- error handling rules

## Current Project Position

cuekit is currently defined as:

- a **lightweight delegation and result-normalization layer for coding agents**
- **conceptually closer to A2A** than to MCP
- **practically exposed through MCP** as the v0 reference control surface
- **smaller in scope than orchestration platforms** like hive-mcp

## v0 Shape

### Core focus
- submit delegated work
- observe task status
- collect normalized results
- cancel delegated work

### Optional / deferred
- steering during execution
- richer event subscriptions
- workflow engine behavior
- kanban / swarm / memory platform concerns

## Minimal Persistent Model

The current v0 persistence direction is:

- global SQLite index at `~/.cuekit/state.db`
- local output files under `<worktree>/.cuekit/`
- minimal tables:
  - `sessions`
  - `tasks`

## Suggested Next Step

The next practical document to add is an **implementation plan** describing:

1. repo scaffold
2. core types
3. SQLite state layer
4. MCP server surface
5. first adapter spike
6. remaining adapters
