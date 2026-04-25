set dotenv-load := false

default:
    @just --list

# Install the local cuekit CLI into Bun's global link store.
install:
    cd packages/mcp && bun link
    cuekit --help

# Remove the local cuekit CLI link from Bun's global link store.
uninstall:
    bun unlink @cuekit/mcp
