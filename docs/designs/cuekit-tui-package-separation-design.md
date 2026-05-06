# Design: move `cuekit tui` into `@cuekit/tui`

## Background

The TUI MVP originally landed under `packages/mcp/src/tui` because that was the fastest route to reuse the existing command context and ship `cuekit tui` behind the main binary. After the MVP, the package boundary is too broad: `@cuekit/mcp` now owns OpenTUI/React dependencies even though the MCP server path does not need a human terminal UI.

## Decision

Move the TUI implementation into a dedicated workspace package:

```text
packages/tui/
  package.json     # @cuekit/tui
  tsconfig.json
  src/
    index.tsx
    app.tsx
    data.ts
    attach.ts
    task-actions.ts
    components/
```

`packages/mcp` remains the owner of the `cuekit` binary and the `cuekit tui` command path, but it lazy-imports the TUI only when that command is used.

```ts
if (isTui) {
  const { runTui } = await import("@cuekit/tui");
  await runTui({ db, registry });
  closeQuietly(db);
  return;
}
```

## Rationale

- Keep `@cuekit/mcp` focused on MCP + structured CLI command surfaces.
- Keep OpenTUI/React dependencies out of the MCP server package and normal MCP startup path.
- Make the human operator UI independently testable.
- Preserve future optional installation or alternative UI packaging.
- Keep the public user command unchanged: `cuekit tui`.

## Dependency direction

Recommended short-term dependency shape:

```text
@cuekit/tui -> @cuekit/core
@cuekit/tui -> @cuekit/store
@cuekit/tui -> @cuekit/adapters
@cuekit/tui -> @cuekit/mcp       # temporary: reuse command-layer functions/types
@cuekit/mcp -> @cuekit/tui       # only for binary lazy import
```

The last two edges form a practical package-level cycle if represented as normal static dependencies. Avoid a static cycle by:

1. exporting a small TUI context/type surface from `@cuekit/mcp`, or
2. moving shared command-layer functions into a future `@cuekit/control` package, or
3. for the immediate refactor, allowing `@cuekit/tui` to receive command/action callbacks from `@cuekit/mcp` instead of importing `@cuekit/mcp` directly.

Preferred immediate approach:

- `@cuekit/tui` exports `runTui(ctx)` where `ctx` is a small interface containing callback functions the TUI needs:
  - `listTasks`
  - `getTaskStatus`
  - `listTaskEvents`
  - `cancelTask`
  - `deleteTask`
  - `steerTask`
  - optional `getTaskById` / transcript path helper
- `@cuekit/mcp/src/bin.ts` adapts existing command-layer functions to this interface and passes them to `runTui`.

This avoids importing `@cuekit/mcp` from `@cuekit/tui` and keeps command logic centralized.

## Refactor plan

1. Create `packages/tui` with OpenTUI/React dependencies and JSX tsconfig.
2. Move `packages/mcp/src/tui/*` to `packages/tui/src/*`.
3. Move TUI tests from `packages/mcp/__tests__/tui-*` to `packages/tui/__tests__/` where possible.
4. Replace direct imports of MCP command functions in TUI code with injected callbacks/interfaces.
5. Remove OpenTUI/React dependencies and JSX config from `packages/mcp`.
6. Add `@cuekit/tui` as a dependency of `@cuekit/mcp` for the binary entrypoint.
7. Update `packages/mcp/src/bin.ts` to lazy-import `@cuekit/tui` only after handling `cuekit tui --help` and after DB/registry setup.
8. Validate:
   - `bun run typecheck`
   - `bun run test`
   - `bun run check`
   - `cuekit tui --help` remains startup-independent
   - `cuekit --mcp` does not load OpenTUI in normal MCP mode

## Non-goals

- Changing the user-facing command name.
- Changing MCP tool names.
- Rewriting the TUI UX.
- Extracting a full `@cuekit/control` package in the same step.

## Future direction

If more non-MCP frontends appear, extract the command-layer functions currently in `@cuekit/mcp/src/commands` into a dedicated package such as `@cuekit/control`. If the human CLI/distribution split proceeds, the installed binary should eventually move to `@cuekit/cli` as described in [Human CLI and distribution design](cuekit-human-cli-distribution-design.md); until then this TUI split can keep `@cuekit/mcp` as the transitional binary owner. At that point:

```text
@cuekit/mcp -> @cuekit/control
@cuekit/tui -> @cuekit/control
```

and the temporary adapter/callback boundary can be removed.
