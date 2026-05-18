---
name: cuekit-release
description: Use when preparing, validating, and publishing a cuekit release. Covers version bumping (all packages), Biome fixes, bundle regeneration, release:check, tagging, and GitHub release creation. Prevents the class of release bugs found in v0.0.6.
---

# cuekit Release

Use this skill when asked to prepare or publish a cuekit release. Follow every step in order — skipping steps is how bugs reach the tag.

## Known Release Bug Classes

These bugs have already occurred. The checklist below is designed to prevent them.

| Bug | Symptom | Root cause |
|---|---|---|
| Stale bundle | `npm install -g` installs old code | `bun run bundle` not run before tag |
| Wrong `--version` output | `cuekit --version` shows old version | `packages/mcp/package.json` not bumped; `mcp/src/cli.ts` reads its own `package.json` for the `--version` handler via `incur`. |
| Bundle drift after Biome | `release:check` fails after `bun run fix` | Biome import reordering changes how bun resolves identifiers (e.g. `join` → `join2`), altering the bundle output |
| Tag points to wrong commit | `bun install -g github:…#vX.Y.Z` installs partially-fixed code | Tag created before all fix PRs merged |

---

## Step-by-Step Release Process

### 1. Read current state

```bash
but status -fv
git log --oneline -5
git tag --sort=-version:refname | head -5
```

Confirm the workspace is clean and identify commits since the last tag.

### 2. Decide version

| Change type | Bump |
|---|---|
| Bug fixes, docs, Biome, skills only | patch (0.0.X) |
| New user-facing feature or MCP surface | minor (0.X.0) |
| Breaking change to protocol/CLI/MCP | major (X.0.0) |

### 3. Biome check — fix first, then bump

Run Biome BEFORE bumping versions so the bundle regenerated after bumping is final:

```bash
bun run check
```

If errors exist, fix them:

```bash
bun run fix
```

After `bun run fix`, **do not commit yet** — the bundle will be regenerated later.

### 4. Bump version

Update `packages/cli/package.json`, `packages/mcp/package.json`, and `packages/tui/package.json` version fields.

```bash
# Update CLI version (the published package)
sed -i '' 's/"version": ".*"/"version": "NEW_VERSION"/' packages/cli/package.json
echo "packages/cli/package.json: $(grep '\"version\"' packages/cli/package.json)"

# Update MCP version (--version reads from here)
sed -i '' 's/"version": ".*"/"version": "NEW_VERSION"/' packages/mcp/package.json
echo "packages/mcp/package.json: $(grep '\"version\"' packages/mcp/package.json)"

# Update TUI version (shown in TUI header)
sed -i '' 's/"version": ".*"/"version": "NEW_VERSION"/' packages/tui/package.json
echo "packages/tui/package.json: $(grep '\"version\"' packages/tui/package.json)"
```

Replace `NEW_VERSION` with the target version string (e.g. `0.0.15`).

**Why all three?** `cuekit --version` reads from `packages/mcp/package.json` (via `mcp/src/cli.ts`). The TUI header reads from `packages/tui/package.json`. npm publish uses `packages/cli/package.json`. If any of these drift, the version display will be inconsistent.

### 5. Regenerate bundle

```bash
bun run bundle
```

This must be run after **both** Biome fixes and version bumps. Running it only after one of them leaves the bundle stale for the other.

### 6. Run release:check

```bash
bun run release:check
```

Expected output:
```
✓ workspace version: X.Y.Z
✓ bundle regenerated
✓ bundle is committed (no uncommitted changes)   ← fails here until committed
✓ bundle contains version: "X.Y.Z"
release-check passed for vX.Y.Z
```

If it fails with "bundle is out of sync", the working-tree bundle differs from HEAD. This is expected before committing — proceed to step 7.

### 7. Verify locally

```bash
bun run typecheck
bun test
bun run check
bun packages/cli/src/bin.ts --version   # must show NEW_VERSION
```

All must pass before creating any commits.

### 8. Commit and push

```bash
git add packages/cli/package.json packages/mcp/package.json packages/tui/package.json bin/cuekit.js packages/cli/bin/cuekit.js
# Stage any Biome-fixed source files too
git commit -m "release: bump version to vX.Y.Z and regenerate bundle"
git push origin main
```

After committing, run `bun run release:check` again to confirm it passes with committed changes:

```bash
bun run release:check
# Must show: release-check passed for vX.Y.Z
```

### 9. Tag and push

```bash
git fetch origin main
git log origin/main --oneline -3   # confirm expected commits present
NEW_SHA=$(git rev-parse origin/main)
git tag vX.Y.Z $NEW_SHA
git push origin vX.Y.Z
```

### 10. Publish to npm

```bash
cd packages/cli
npm publish --access public
```

### 11. Verify the release

```bash
npm install -g cuekit@X.Y.Z
cuekit --version   # must show X.Y.Z
```

If `--version` shows the old version, the bundle or package.json bump was incomplete.

---

## Re-releasing (fixing a bad tag)

If a tag was already pushed but the release has issues:

```bash
# Delete the npm version first
npm unpublish cuekit@X.Y.Z

# Delete the local tag
git tag -d vX.Y.Z

# Delete the remote tag
git push origin --delete vX.Y.Z
```

Then fix the issue, merge the fix to main, and repeat steps 9–10.

**Always unpublish from npm before deleting the tag** — npm will reject re-publishing the same version.

---

## Validation Checklist

Before tagging, every item must be ✓:

- [ ] `packages/cli/package.json` at new version
- [ ] `packages/mcp/package.json` at new version (`--version` source)
- [ ] `packages/tui/package.json` at new version (shown in TUI header)
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes (0 failures)
- [ ] `bun run check` passes (0 Biome errors)
- [ ] `bun run bundle` run after all source changes
- [ ] `bun run release:check` passes with committed bundle
- [ ] `bun packages/cli/src/bin.ts --version` shows new version
- [ ] All fix/feature PRs merged to `main` before tagging
- [ ] Tag points to final `origin/main` HEAD
- [ ] `cuekit --version` after `npm install -g cuekit` confirms new version

---

## CLI Fallbacks

If `gh` is unavailable:
```bash
git push origin vX.Y.Z
# Create release manually at https://github.com/takemo101/cuekit/releases/new
```

---

## File Reference

| File | Role |
|---|---|
| `packages/cli/package.json` | Published package version; canonical source for `release:check` |
| `packages/mcp/package.json` | Version shown by `cuekit --version` (via `mcp/src/cli.ts` → `incur`) |
| `packages/tui/package.json` | Version shown in TUI header |
| `bin/cuekit.js` | Committed bundle; what `npm install -g cuekit` actually installs |
| `packages/cli/bin/cuekit.js` | Bundle copied for npm publish |
| `scripts/release-check.ts` | Pre-tag validation script |
