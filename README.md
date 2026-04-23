# cuekit

Protocol and adapter foundation for orchestrating coding agents, with an `incur`-based control surface for both CLI commands and MCP tools.

## Overview

cuekit is a lightweight delegation substrate for coding agents.

- `@cuekit/core` defines the protocol, schemas, and state transition rules
- `@cuekit/store` persists sessions/tasks in SQLite and tracks local result refs
- `@cuekit/adapters` maps runtime-specific behavior into the cuekit protocol
- `@cuekit/mcp` provides the reference control surface using `incur`, exposing the same command definitions as both CLI commands and MCP tools

## Design references

- Specs: [`docs/specs/README.md`](docs/specs/README.md)
- Architecture: [`docs/architecture/README.md`](docs/architecture/README.md)
