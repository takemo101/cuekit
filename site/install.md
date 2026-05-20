# Install

cuekit ships as a single npm package. The recommended path is the npm registry; GitHub source installs are supported for pinned or pre-release tags.

## Requirements

- **[Bun](https://bun.sh) ≥ 1.2** — cuekit is a Bun workspace and the CLI bundles for the Bun runtime.
- **A terminal multiplexer** on `PATH`:
  - **tmux** (default) with `new-session -e` support
  - **[zellij](https://github.com/zellij-org/zellij)** ≥ 0.43 — opt-in via `.cuekit.yaml`
  - **[herdr](https://herdr.dev)** ≥ 0.5 — opt-in via `.cuekit.yaml`
- At least one **coding agent adapter** on `PATH` (claude-code, opencode, jcode, gemini, or pi).

## From npm (recommended)

Latest:

```sh
npm install -g cuekit@latest
cuekit doctor
cuekit mcp config
```

Pinned to a specific version:

```sh
npm install -g cuekit@0.0.15
cuekit doctor
```

::: tip
Restart your MCP clients after every cuekit upgrade so they pick up the new tool definitions.
:::

## From GitHub source

For pinned tags or pre-release builds:

```sh
bun install -g github:takemo101/cuekit#v0.0.15
```

For local development:

```sh
git clone https://github.com/takemo101/cuekit
cd cuekit
bun install
bun link                              # exposes `cuekit` from the workspace
# or run directly:
bun packages/cli/src/bin.ts <command>
```

## Upgrading

```sh
npm uninstall -g cuekit
npm install -g cuekit@latest
```

After installing a newer version, restart MCP clients.

### Legacy installs (before v0.0.12)

If you installed cuekit before v0.0.12 via GitHub directly:

```sh
bun remove -g cuekit-workspace
npm install -g cuekit@latest
```

If you installed via Homebrew's npm at `/opt/homebrew/bin/cuekit`:

```sh
/opt/homebrew/bin/npm uninstall -g cuekit
npm install -g cuekit@latest
```

## Verify

```sh
cuekit --version          # prints the version from packages/mcp
cuekit doctor             # checks Bun, multiplexer, adapters
cuekit adapter list       # shows runtime capabilities per adapter
```

## Uninstall

```sh
npm uninstall -g cuekit
```

For legacy installs before v0.0.12, see the [Legacy installs](#legacy-installs-before-v0-0-12) section above.

Verify removal:

```sh
which cuekit          # should report nothing
npm list -g cuekit    # should be empty
```

## What gets created

After your first `cuekit init` + task submission, cuekit creates:

| Path | Purpose |
|---|---|
| `~/.cuekit/state.db` | Global SQLite index (WAL mode). Tasks, teams, events, sessions, schema migrations. |
| `~/.cuekit/agents/*.md` | User-scope agent profiles (optional). |
| `<repo>/.cuekit.yaml` | Project config (safe submit defaults, strategies, multiplexer choice). |
| `<repo>/.cuekit/tasks/<task_id>/` | Per-task artifacts: `transcript.txt`, `result.json`, anything the adapter drops. |
| `<repo>/.cuekit/agents/*.md` | Project-scope agent profiles (optional). |

## Next

- [Quickstart](/quickstart) — submit your first child task.
- [Agent Profiles](/guides/agent-profiles) — role-based child instructions.
- [Team Strategies](/guides/team-strategies) — project-local team playbooks.
