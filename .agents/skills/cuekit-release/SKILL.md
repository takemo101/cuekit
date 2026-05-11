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
| Stale bundle | `bun install -g` installs old code | `bun run bundle` not run before tag |
| Wrong `--version` output | `cuekit --version` shows old version | Only `packages/cli/package.json` bumped; `packages/mcp` and others still old. `mcp/src/cli.ts` reads its own `package.json` for the `--version` handler via `incur`. |
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

### 4. Bump ALL packages

**All 8 packages must be bumped together.** Only bumping `packages/cli` causes `cuekit --version` to report the old version.

```bash
for f in packages/adapters/package.json \
          packages/agent-profiles/package.json \
          packages/cli/package.json \
          packages/core/package.json \
          packages/mcp/package.json \
          packages/project-config/package.json \
          packages/store/package.json \
          packages/tui/package.json; do
  sed -i '' "s/\"version\": \".*\"/\"version\": \"NEW_VERSION\"/" "$f"
  echo "$f: $(grep '\"version\"' $f)"
done
```

Replace `NEW_VERSION` with the target version string (e.g. `0.0.7`).

Verify all packages show the new version:

```bash
for f in packages/*/package.json; do echo "$f: $(grep '"version"' $f)"; done
```

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

### 8. Commit (GitButler)

Stage and commit in logical groups. This project uses GitButler (`but`):

```bash
# Create a release branch
but branch new release/vX.Y.Z

# Stage all package.json files, Biome-fixed source files, and bin/cuekit.js
but stage packages/adapters/package.json release/vX.Y.Z
but stage packages/agent-profiles/package.json release/vX.Y.Z
but stage packages/cli/package.json release/vX.Y.Z
but stage packages/core/package.json release/vX.Y.Z
but stage packages/mcp/package.json release/vX.Y.Z
but stage packages/project-config/package.json release/vX.Y.Z
but stage packages/store/package.json release/vX.Y.Z
but stage packages/tui/package.json release/vX.Y.Z
but stage bin/cuekit.js release/vX.Y.Z
# Stage any Biome-fixed source files too
but stage <biome-fixed-files> release/vX.Y.Z

but commit release/vX.Y.Z -m "release: bump all packages to vX.Y.Z and regenerate bundle"
```

After committing, run `bun run release:check` again to confirm it passes with committed changes:

```bash
bun run release:check
# Must show: release-check passed for vX.Y.Z
```

### 9. Push and merge PR

```bash
but push release/vX.Y.Z
gh pr create --base main --head release/vX.Y.Z \
  --title "release: vX.Y.Z" \
  --body "Version bump for all packages, bundle regeneration, release:check passed."
gh pr merge <PR_NUMBER> --squash --subject "release: vX.Y.Z"
```

Wait for merge and note the merge commit SHA:

```bash
gh pr view <PR_NUMBER> --json state,mergeCommit
```

### 10. Tag the merged commit — not before

Always tag the FINAL `origin/main` HEAD after all PRs are merged. Never tag intermediate commits.

```bash
git fetch origin main
git log origin/main --oneline -3   # confirm expected commits present
NEW_SHA=$(git rev-parse origin/main)
git tag vX.Y.Z $NEW_SHA
git push origin vX.Y.Z
```

### 11. Create GitHub release

```bash
gh release create vX.Y.Z \
  --title "vX.Y.Z — <short title>" \
  --notes "$(cat <<'EOF'
## What's new in vX.Y.Z
...

## Installation
\`\`\`sh
bun install -g github:takemo101/cuekit#vX.Y.Z
\`\`\`
EOF
)"
```

### 12. Verify the release

```bash
bun install -g github:takemo101/cuekit#vX.Y.Z
cuekit --version   # must show X.Y.Z
```

If `--version` shows the old version, the bundle or package.json bump was incomplete. See "Re-releasing" below.

---

## Re-releasing (fixing a bad tag)

If a tag was already pushed but the release has issues:

```bash
# Delete the GitHub release first (before the tag)
gh release delete vX.Y.Z --yes

# Delete the local tag
git tag -d vX.Y.Z

# Delete the remote tag
git push origin --delete vX.Y.Z
```

Then fix the issue, merge the fix to main, and repeat steps 10–12.

**Always delete the GitHub release before the tag** — `gh release delete` can fail if the release no longer has a tag to reference.

---

## Validation Checklist

Before tagging, every item must be ✓:

- [ ] All 8 `packages/*/package.json` at new version
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes (0 failures)
- [ ] `bun run check` passes (0 Biome errors)
- [ ] `bun run bundle` run after all source changes
- [ ] `bun run release:check` passes with committed bundle
- [ ] `bun packages/cli/src/bin.ts --version` shows new version
- [ ] All fix/feature PRs merged to `main` before tagging
- [ ] Tag points to final `origin/main` HEAD
- [ ] `cuekit --version` after `bun install -g` confirms new version

---

## CLI Fallbacks

If `but` is unavailable, fall back to git + the GitButler pre-commit hook bypass is NOT available — investigate why `but` is missing before proceeding.

If `gh` is unavailable:
```bash
git push origin vX.Y.Z
# Create release manually at https://github.com/takemo101/cuekit/releases/new
```

---

## File Reference

| File | Role |
|---|---|
| `packages/cli/package.json` | Canonical version source for `release:check` |
| `packages/mcp/package.json` | Version shown by `cuekit --version` (via `mcp/src/cli.ts` → `incur`) |
| All other `packages/*/package.json` | Must match for consistency |
| `bin/cuekit.js` | Committed bundle; what `bun install -g` actually installs |
| `scripts/release-check.ts` | Pre-tag validation script |
| `justfile` | `just install` installs a dev-loop wrapper (not the bundle) |
