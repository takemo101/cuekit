# cuekit Human CLI and Distribution Design

## Status

Approved design direction — pre-implementation.

## Summary

Separate the installed human `cuekit` binary into a future `@cuekit/cli` package. Keep `@cuekit/mcp` focused on the protocol/MCP control surface and let `@cuekit/cli` own setup, diagnostics, update guidance, and other distribution-facing commands.

This keeps one user-facing command while making package ownership explicit:

```text
@cuekit/cli  -> human CLI, setup, distribution helpers, command dispatch
@cuekit/mcp  -> MCP server and protocol/control command projection
```

`@cuekit/mcp` must not import `@cuekit/cli`. The CLI package may delegate protocol commands and MCP server startup to `@cuekit/mcp`.

## Package Boundary

Target package shape:

```text
@cuekit/core       protocol/schema/lifecycle primitives
@cuekit/store      SQLite persistence
@cuekit/adapters   runtime bindings
@cuekit/mcp        MCP and protocol control operations
@cuekit/tui        human terminal UI
@cuekit/cli        installed human CLI and distribution/setup commands
```

Long term, the installed binary should be owned by `@cuekit/cli` / the root distribution entry point:

```json
{
  "bin": {
    "cuekit": "packages/cli/src/bin.ts"
  }
}
```

The CLI dispatches human commands first, then delegates protocol commands to `@cuekit/mcp`:

```text
cuekit doctor          -> @cuekit/cli local setup diagnostics
cuekit update          -> @cuekit/cli update advisor
cuekit init            -> @cuekit/cli project setup helper
cuekit tui             -> @cuekit/cli -> @cuekit/tui
cuekit mcp config      -> @cuekit/cli human MCP-client setup helper
cuekit --mcp           -> @cuekit/mcp stdio server
cuekit task/team/...   -> @cuekit/mcp protocol/control command projection
```

## CLI-only Setup and Update Helpers

`cuekit doctor` and `cuekit update` are human-only commands. They should not be exposed as MCP tools.

- `cuekit doctor` checks the local environment and setup state: cuekit version/ref, Bun version, `tmux`, writable state/SQLite path, project config discovery, MCP config helper availability, and update availability when GitHub release lookup succeeds. It should avoid changing files and only suggest next commands.
- `cuekit update` advises the user how to update. It may read the current version/ref and latest GitHub release tag, then print the exact install command, for example:

```sh
bun install -g github:takemo101/cuekit#v0.1.1
```

`cuekit update` should not run `bun install` by default. A future `--yes` mode can be considered only after version detection and the install path are reliable.

## MCP Surface Policy

`@cuekit/mcp` remains responsible for AI/protocol operations such as submit, status, wait, result, steer, cleanup, delete, team, strategy, and child reports. It should not gain distribution or setup tools like `doctor` and `update`.

Rationale:

- AI callers should not casually update their own control substrate.
- Environment diagnostics are human setup UX, not delegation protocol.
- Keeping MCP focused preserves the grouped AI-facing surface from ADR 002.

If an AI parent needs diagnostics, it can ask a human to run `cuekit doctor` or invoke the human CLI explicitly through normal shell access; cuekit should not advertise diagnostics/update as protocol operations.

## Distribution Note

Initial public distribution can use Bun's GitHub installer before npm publishing:

```sh
bun install -g github:takemo101/cuekit#v0.1.0
```

Release tags should be immutable, and users should update by installing a newer tag. Installing from `main` can remain an undocumented or developer-only escape hatch.

## Migration Sketch

1. Add `packages/cli` with `doctor` and `update` command modules while keeping existing `@cuekit/mcp` binary behavior intact.
2. Switch the installed `cuekit` bin target to `@cuekit/cli` / the root distribution entry point.
3. Move or wrap human setup commands (`init`, `tui`, `mcp config/add`) under CLI ownership while preserving behavior.
4. Keep `@cuekit/mcp` exports focused on programmatic MCP server startup and protocol/control operations.

## Open Questions

- Where should the canonical version live before npm publishing: root `package.json`, generated build metadata, or Git tags only?
- Should `doctor` include `--json` for issue reports, even though it remains human-only?
- Should `doctor` validate tmux behavior with a temporary session or only check `tmux -V` in the first slice?
