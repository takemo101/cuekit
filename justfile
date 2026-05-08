set dotenv-load := false

default:
    @just --list

# Install a local cuekit CLI wrapper without changing the tracked bin file mode.
install:
    mkdir -p "$HOME/.bun/bin"
    rm -f "$HOME/.bun/bin/cuekit"
    printf '%s\n' '#!/usr/bin/env sh' 'exec bun "{{ justfile_directory() }}/packages/cli/src/bin.ts" "$@"' > "$HOME/.bun/bin/cuekit"
    chmod 755 "$HOME/.bun/bin/cuekit"
    "$HOME/.bun/bin/cuekit" --help

# Remove the local cuekit CLI wrapper that `just install` created.
# This recipe only removes the dev-loop shell wrapper at
# ~/.bun/bin/cuekit. It does NOT touch any globally-installed
# `cuekit-workspace` package — for that, see the Uninstall section
# in README.md (`bun remove -g cuekit-workspace`).
uninstall:
    rm -f "$HOME/.bun/bin/cuekit"
