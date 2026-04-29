set dotenv-load := false

default:
    @just --list

# Install a local cuekit CLI wrapper without changing the tracked bin file mode.
install:
    mkdir -p "$HOME/.bun/bin"
    rm -f "$HOME/.bun/bin/cuekit"
    printf '%s\n' '#!/usr/bin/env sh' 'exec bun "{{ justfile_directory() }}/packages/mcp/src/bin.ts" "$@"' > "$HOME/.bun/bin/cuekit"
    chmod 755 "$HOME/.bun/bin/cuekit"
    "$HOME/.bun/bin/cuekit" --help

# Remove the local cuekit CLI wrapper.
uninstall:
    rm -f "$HOME/.bun/bin/cuekit"
    bun unlink @cuekit/mcp || true
