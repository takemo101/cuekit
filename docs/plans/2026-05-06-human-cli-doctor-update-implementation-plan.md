# Human CLI Doctor/Update Implementation Plan

> **For agentic workers:** REQUIRED: Use cuekit team strategies for non-trivial cuekit repo work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the installed human `cuekit` binary into `@cuekit/cli` and add MVP `cuekit doctor` plus advisory-only `cuekit update` without expanding the MCP tool surface.

**Architecture:** Add a new `packages/cli` package that owns human-only command dispatch and delegates protocol/MCP operations to `@cuekit/mcp`. Keep `@cuekit/mcp` focused on operation registry, MCP server startup, and CLI projections of protocol operations. Implement `doctor` and `update` as side-effect-light modules with testable dependency injection for filesystem, process, PATH, and GitHub release lookup.

**Tech Stack:** TypeScript, Bun, incur-backed existing MCP CLI, `bun:test`, workspace packages, GitHub Releases API, existing `@cuekit/project-config`, `@cuekit/store`, `@cuekit/tui`, and `@cuekit/mcp` packages.

---

## Design References

- `docs/designs/cuekit-human-cli-distribution-design.md`
- `docs/designs/cuekit-tui-package-separation-design.md`
- `docs/decisions/002-grouped-mcp-surface.md`
- `packages/mcp/src/bin.ts`
- `packages/mcp/src/cli.ts`
- `packages/mcp/src/operations.ts`
- `packages/project-config/src/apply.ts`
- `packages/store/src/db.ts`
- `packages/tui/src/index.ts`

## Issue Breakdown

1. **Issue #328 — Add `@cuekit/cli` package skeleton and shared command result helpers**
   - Scope: package, tsconfig, public exports, small test harness, non-mutating output helpers.
   - Output: `@cuekit/cli` typechecks/tests independently, but is not yet the installed binary owner.

2. **Issue #329 — Move binary ownership and preserve existing command behavior**
   - Scope: `packages/cli/src/bin.ts` dispatch wrapper, root/package bin wiring, delegation to existing MCP/TUI/init code paths.
   - Output: `cuekit --help`, `cuekit --mcp`, `cuekit init`, `cuekit tui`, `cuekit mcp config`, and protocol commands still work through the new binary path. `doctor` and `update` may be reserved in the classifier, but should not be advertised as working commands until #330 and #331 implement them unless they return an explicit "not implemented yet" result.

3. **Issue #330 — Implement `cuekit doctor` MVP diagnostics**
   - Scope: diagnostic checks only; no writes, no migrations beyond safe open/writability checks.
   - Output: human readable `cuekit doctor` with deterministic tests for OK/warn/fail states.

4. **Issue #331 — Implement advisory-only `cuekit update` MVP**
   - Scope: current version/ref display, latest GitHub release lookup, exact Bun install command, offline fallback.
   - Output: `cuekit update` never runs `bun install` by default and is covered by mocked fetch tests.

5. **Issue #332 — Consolidate human setup helpers under `@cuekit/cli` ownership**
   - Scope: move or wrap `init`, `tui`, and `mcp config/add` under CLI ownership while keeping MCP package dependency direction clean.
   - Output: `@cuekit/mcp` no longer owns human setup command implementation, and `@cuekit/mcp -/-> @cuekit/cli` remains true.

6. **Issue #333 — Validate GitHub/Bun distribution path and docs**
   - Scope: package metadata, smoke install notes, README/docs updates, final validation.
   - Output: documented release/install/update flow and evidence for `bun install -g github:takemo101/cuekit#<tag>` feasibility.

---

## Chunk 1: `@cuekit/cli` Package Skeleton

### Task 1: Add CLI package shell with testable output helpers

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/output.ts`
- Create: `packages/cli/__tests__/output.test.ts`
- Modify: root `package.json` only if workspace scripts need a package-specific target.

- [ ] **Step 1: Write failing tests for output formatting**

Create `packages/cli/__tests__/output.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { formatCheckLine, formatCommandBlock } from "../src/output.ts";

describe("CLI output helpers", () => {
  it("formats status check lines consistently", () => {
    expect(formatCheckLine({ level: "ok", label: "bun", detail: "1.2.0" })).toBe("✓ bun: 1.2.0");
    expect(formatCheckLine({ level: "warn", label: "update", detail: "v0.1.1 available" })).toBe("! update: v0.1.1 available");
    expect(formatCheckLine({ level: "fail", label: "tmux", detail: "not found" })).toBe("✗ tmux: not found");
  });

  it("formats command blocks with indentation", () => {
    expect(formatCommandBlock("Run", "bun install -g github:takemo101/cuekit#v0.1.1")).toContain(
      "  bun install -g github:takemo101/cuekit#v0.1.1",
    );
  });
});
```

- [ ] **Step 2: Add package metadata**

Create `packages/cli/package.json`:

```json
{
  "name": "@cuekit/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@cuekit/core": "workspace:*"
  }
}
```

Do not add `bin.cuekit` in Chunk 1 because `packages/cli/src/bin.ts` is not created until Chunk 2. Add the bin entry in Chunk 2 Step 4 only after the file exists and dispatch tests pass.

- [ ] **Step 3: Add a focused tsconfig**

Create `packages/cli/tsconfig.json` following existing package tsconfig conventions. Include `src/**/*.ts` and `__tests__/**/*.ts`.

- [ ] **Step 4: Implement helpers**

Create `packages/cli/src/output.ts`:

```ts
export type CheckLevel = "ok" | "warn" | "fail";

export type CheckLine = {
  level: CheckLevel;
  label: string;
  detail: string;
};

const SYMBOLS: Record<CheckLevel, string> = {
  ok: "✓",
  warn: "!",
  fail: "✗",
};

export function formatCheckLine(line: CheckLine): string {
  return `${SYMBOLS[line.level]} ${line.label}: ${line.detail}`;
}

export function formatCommandBlock(label: string, command: string): string {
  return `${label}:\n\n  ${command}\n`;
}
```

- [ ] **Step 5: Export public helpers**

Create `packages/cli/src/index.ts`:

```ts
export * from "./output.ts";
```

- [ ] **Step 6: Run targeted validation**

Run:

```bash
bun test packages/cli/__tests__/output.test.ts
bun run typecheck
bun run check
```

Expected: all pass.

---

## Chunk 2: Binary Ownership and Delegation

### Task 2: Move installed `cuekit` bin dispatch to `@cuekit/cli`

**Files:**
- Create: `packages/cli/src/bin.ts`
- Create: `packages/cli/src/help.ts`
- Create: `packages/cli/__tests__/bin-dispatch.test.ts`
- Modify: `packages/cli/package.json`
- Modify: `packages/mcp/package.json`
- Modify: root `package.json`
- Modify: `packages/mcp/src/bin.ts` if helper exports are needed.
- Modify: `packages/mcp/src/index.ts` if server/CLI startup functions need to become public.

- [ ] **Step 1: Write dispatch classification tests**

Create tests around a pure `classifyCuekitCommand(argv)` function before wiring process globals:

```ts
expect(classifyCuekitCommand(["doctor"])).toEqual({ kind: "reserved-human", command: "doctor" });
expect(classifyCuekitCommand(["update"])).toEqual({ kind: "reserved-human", command: "update" });
expect(classifyCuekitCommand(["init"])).toEqual({ kind: "human", command: "init" });
expect(classifyCuekitCommand(["tui"])).toEqual({ kind: "human", command: "tui" });
expect(classifyCuekitCommand(["mcp", "config"])).toEqual({ kind: "human", command: "mcp-config" });
expect(classifyCuekitCommand(["--mcp"])).toEqual({ kind: "mcp" });
expect(classifyCuekitCommand(["task", "submit"])).toEqual({ kind: "protocol" });
```

- [ ] **Step 2: Add CLI help text**

Move the top-level human help text from `packages/mcp/src/bin.ts` into `packages/cli/src/help.ts`. In #329, keep help limited to commands that actually work after the binary move:

```text
Human-only commands:
  cuekit init     Create .cuekit.yaml and update .gitignore
  cuekit tui      Open the interactive task cockpit
```

`doctor` and `update` can be reserved by the classifier in this issue, but they should either stay out of normal help until #330/#331 or return a tested explicit "not implemented yet" message with a non-zero exit code.

- [ ] **Step 3: Add `packages/cli/src/bin.ts` as thin dispatch**

Implement process-level wiring in one small file. For the first slice, delegate existing behavior by importing an exported `runMcpBin(argv, env)` / `main`-like function from `@cuekit/mcp` or by retaining a temporary fallback import. Avoid copying the entire MCP bin body.

- [ ] **Step 4: Update package bin ownership**

Move the `cuekit` bin from `@cuekit/mcp` to `@cuekit/cli`:

- `packages/cli/package.json`: keep `bin.cuekit = "./src/bin.ts"`.
- `packages/mcp/package.json`: remove `bin.cuekit` after the new route is working.
- root `package.json`: add a root `bin` only if Bun GitHub install requires root-level bin resolution for this workspace.

- [ ] **Step 5: Preserve MCP package startup**

Ensure `@cuekit/mcp` still exports programmatic startup for the stdio server / command projection. `@cuekit/mcp` must not import `@cuekit/cli`.

- [ ] **Step 6: Run behavior smoke tests**

Run:

```bash
bun run typecheck
bun test packages/cli packages/mcp/__tests__/cli.test.ts packages/mcp/__tests__/mcp-stdio-integ.test.ts
bun run check
bun run packages/cli/src/bin.ts --help
bun run packages/cli/src/bin.ts strategy list --cwd . --format json
```

Expected: existing protocol behavior still works; help remains honest about implemented commands; MCP tool list still excludes human-only commands.

---

## Chunk 3: `cuekit doctor` MVP

### Task 3: Implement non-mutating local diagnostics

**Files:**
- Create: `packages/cli/src/doctor.ts`
- Create: `packages/cli/__tests__/doctor.test.ts`
- Modify: `packages/cli/src/bin.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/package.json` dependencies as needed (`@cuekit/store`, `@cuekit/project-config`).

- [ ] **Step 1: Write tests with injected dependencies**

Use a dependency-injected shape so tests do not depend on the developer machine:

```ts
const result = await runDoctor({
  cwd: "/repo",
  env: {},
  exec: fakeExec({ bun: "1.2.0", tmux: "tmux 3.5a" }),
  exists: (path) => path.endsWith(".cuekit.yaml"),
  checkWritableState: async () => ({ ok: true, path: "~/.cuekit/state.db" }),
  getCurrentVersion: () => "v0.1.0",
  getLatestRelease: async () => ({ ok: true, tag: "v0.1.1" }),
});

expect(result.exitCode).toBe(0);
expect(result.stdout).toContain("✓ bun: 1.2.0");
expect(result.stdout).toContain("! update: v0.1.1 available");
```

Also test missing `tmux` returns a `fail` check and `exitCode` 1 according to the MVP severity rules below.

- [ ] **Step 2: Define diagnostic model**

In `doctor.ts`, define:

```ts
export type DoctorLevel = "ok" | "warn" | "fail";
export type DoctorCheck = { level: DoctorLevel; label: string; detail: string };
export type DoctorResult = { exitCode: number; checks: DoctorCheck[]; stdout: string; stderr?: string };
```

Severity rules for the MVP:

- `fail`: a local prerequisite needed for normal cuekit operation is missing or unusable, such as Bun not found, `tmux` not found, state path not writable, or discovered `.cuekit.yaml` failing to parse. Any `fail` check makes `exitCode` 1.
- `warn`: useful but non-blocking setup information is unavailable or needs attention, such as unknown cuekit version/ref, no project config found in a directory where cuekit can still run by path scope, GitHub release lookup failure, or an update being available. Warnings keep `exitCode` 0 when there are no failures.
- `ok`: check succeeded and should include the detected version/path/detail when useful.

- [ ] **Step 3: Implement checks**

MVP checks:

1. cuekit version/ref if available.
2. Bun exists and version is readable.
3. `tmux -V` succeeds.
4. state DB path/dir is writable without deleting or migrating user data unexpectedly.
5. `.cuekit.yaml` discovery in current project.
6. MCP config helper availability.
7. update availability if latest release lookup succeeds.

Use the severity rules defined with the diagnostic model above.

- [ ] **Step 4: Wire `cuekit doctor`**

Add `doctor --help` and normal command execution in `packages/cli/src/bin.ts`.

- [ ] **Step 5: Validate non-mutating behavior**

Tests should assert no calls to write/init/register/update functions. Then run:

```bash
bun test packages/cli/__tests__/doctor.test.ts
bun run typecheck
bun run check
```

Expected: PASS.

---

## Chunk 4: `cuekit update` Advisory MVP

### Task 4: Print latest release install command without self-mutation

**Files:**
- Create: `packages/cli/src/update.ts`
- Create: `packages/cli/__tests__/update.test.ts`
- Modify: `packages/cli/src/bin.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write tests for latest release output**

Mock fetch/dependency injection:

```ts
const result = await runUpdate({
  getCurrentVersion: () => "v0.1.0",
  getLatestRelease: async () => ({ ok: true, tag: "v0.1.1" }),
});

expect(result.exitCode).toBe(0);
expect(result.stdout).toContain("Current: v0.1.0");
expect(result.stdout).toContain("Latest:  v0.1.1");
expect(result.stdout).toContain("bun install -g github:takemo101/cuekit#v0.1.1");
expect(result.stdout).toContain("restart any MCP client");
```

Also test offline lookup failure prints manual guidance without pretending to know a tag, for example:

```text
Could not fetch the latest release tag.
Open https://github.com/takemo101/cuekit/releases and then run:
  bun install -g github:takemo101/cuekit#<release-tag>
```

The angle-bracket token must be explained as a placeholder, not printed as an exact command.

- [ ] **Step 2: Implement GitHub release lookup**

Use `fetch("https://api.github.com/repos/takemo101/cuekit/releases/latest")` with injected fetch for tests. Handle:

- network errors,
- non-2xx responses,
- missing `tag_name`,
- prerelease policy according to the first-slice decision (`/releases/latest` ignores prereleases by default).

- [ ] **Step 3: Implement version/ref detection**

First slice can read root/package package version when available or print `unknown`. Do not block update guidance if current version cannot be detected.

- [ ] **Step 4: Wire command and help**

Add `cuekit update --help` and normal command execution.

- [ ] **Step 5: Guard against accidental self-mutation**

Do not call `bun install`, `spawn`, or shell execution in `runUpdate`. Add a test double that would fail if command execution is attempted.

- [ ] **Step 6: Validate**

Run:

```bash
bun test packages/cli/__tests__/update.test.ts
bun run typecheck
bun run check
```

Expected: PASS.

---

## Chunk 5: Human Setup Helper Consolidation

### Task 5: Move or wrap `init`, `tui`, and MCP config helpers under CLI ownership

**Files:**
- Modify: `packages/cli/src/bin.ts`
- Create/Modify: `packages/cli/src/init-command.ts`
- Create/Modify: `packages/cli/src/tui-command.ts`
- Create/Modify: `packages/cli/src/mcp-config-command.ts`
- Modify: `packages/mcp/src/bin.ts`
- Modify: `packages/mcp/src/pi-mcp-config.ts` exports if needed.
- Modify/Test: `packages/cli/__tests__/human-commands.test.ts`
- Modify/Test: existing `packages/mcp/__tests__/cli.test.ts` assertions around hidden human commands.

- [ ] **Step 1: Write tests for command ownership**

Assert:

- `@cuekit/cli` classifies and handles `init`, `tui`, `mcp config`, `mcp add --agent pi`, `doctor`, and `update`.
- `@cuekit/mcp` operation lists still do not expose `init`, `tui`, `doctor`, or `update` as MCP operations.

- [ ] **Step 2: Extract `init` helpers from MCP bin**

Move help/summary/warning wrappers into `@cuekit/cli`, while keeping reusable project config logic in `@cuekit/project-config`.

- [ ] **Step 3: Extract `tui` command wrapper**

Move TUI command help and lazy import wiring into `@cuekit/cli`. Preserve existing startup-independent `cuekit tui --help` behavior.

- [ ] **Step 4: Extract MCP config human helpers**

Move human routing for `cuekit mcp config` and `cuekit mcp add --agent pi` into `@cuekit/cli`, delegating only the protocol/config implementation needed from `@cuekit/mcp` or a small helper package. Keep `show_mcp_config` CLI-only and absent from MCP tools.

- [ ] **Step 5: Check dependency direction**

Run or add a simple static test/script assertion that `packages/mcp/src/**` does not import `@cuekit/cli`.

- [ ] **Step 6: Validate existing behavior**

Run:

```bash
bun test packages/cli packages/mcp/__tests__/cli.test.ts packages/tui/__tests__/tui-smoke.test.ts
bun run typecheck
bun run check
```

Expected: PASS.

---

## Chunk 6: Distribution Validation and Docs

### Task 6: Document and smoke-test Bun/GitHub distribution path

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md` if needed.
- Modify: `docs/designs/cuekit-human-cli-distribution-design.md` if implementation resolves open questions.
- Create: `docs/guides/install.md` if install docs outgrow README.
- Modify: root `package.json`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Verify package metadata for GitHub install**

Confirm whether Bun resolves root `bin` or workspace package `bin` for:

```bash
bun install -g github:takemo101/cuekit#<tag-or-test-ref>
```

Use a local or temporary test tag/ref only if safe. Do not publish npm.

- [ ] **Step 2: Add install/update docs**

Document:

```sh
bun install -g github:takemo101/cuekit#v0.1.0
cuekit doctor
cuekit mcp config
cuekit update
```

Clarify that `cuekit update` prints the next install command and does not self-update by default.

- [ ] **Step 3: Add release checklist notes**

Document release expectations:

- immutable tags,
- GitHub Release tag is the update source,
- restart MCP clients after update,
- `main` install is developer-only/undocumented.

- [ ] **Step 4: Run full validation**

Run:

```bash
bun run fix
bun run check
bun run typecheck
bun test
```

Expected: all pass.

- [ ] **Step 5: Dogfood final commands**

Run at least:

```bash
cuekit --help
cuekit doctor
cuekit update
cuekit mcp config
cuekit strategy list --cwd . --format json
```

Expected: commands work through the installed/new binary path, and MCP surface remains unchanged.

---

## Final Acceptance Criteria

- `@cuekit/cli` owns the installed `cuekit` binary.
- `@cuekit/mcp` does not import `@cuekit/cli`.
- `cuekit doctor` is non-mutating and reports local setup diagnostics.
- `cuekit update` is advisory-only and never runs `bun install` unless a future explicit flag is introduced.
- `doctor` and `update` are not MCP tools and do not appear in the MCP operation list.
- Existing command behavior remains stable for `init`, `tui`, `mcp config/add`, `--mcp`, and protocol command groups.
- Bun/GitHub tag install path is documented and verified as far as possible before release.
- `bun run check`, `bun run typecheck`, and `bun test` pass.
