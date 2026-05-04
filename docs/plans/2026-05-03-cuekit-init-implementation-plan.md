# cuekit Init Command Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a human-facing `cuekit init` command that scaffolds a safe `.cuekit.yaml` and ignores local cuekit task artifacts.

**Architecture:** Keep initialization logic in `@cuekit/project-config` so rendering, path/id derivation, and `.gitignore` update rules are reusable and testable without MCP runtime setup. Wire `cuekit init` directly in `packages/mcp/src/bin.ts` as a human CLI-only path, separate from `CUEKIT_OPERATIONS`, so it is not exposed as an MCP tool. Generate only safe project-local config values and avoid changing submit routing by default.

**Tech Stack:** TypeScript, Bun, existing `@cuekit/project-config` package, existing `@cuekit/mcp` binary entrypoint, Zod/Incur patterns for structured output where useful, GitButler workflow.

---

## Source design

- Design doc section: `docs/designs/cuekit-project-config-design.md` → `Phase 5: Project init command`
- Implementation issues:
  - #183 `Add project config init helpers`
  - #184 `Add cuekit init CLI command`
  - #185 `Document cuekit init`
- Example config: `.cuekit.example.yaml`
- Project config schema: `packages/project-config/src/schema.ts`
- Project config exports: `packages/project-config/src/index.ts`
- CLI entrypoint and existing human-only TUI path: `packages/mcp/src/bin.ts`
- CLI/MCP operation registry that `init` must not join: `packages/mcp/src/operations.ts`
- CLI tests: `packages/mcp/__tests__/cli.test.ts`

## File map

### Project-config package

- Create `packages/project-config/src/init.ts`
  - Sanitize current directory name into a valid `project.id`.
  - Render safe `.cuekit.yaml` content.
  - Compute `.gitignore` content updates.
  - Execute init with `dryRun`, `force`, and `gitignore` options.
  - Return a typed summary rather than printing directly.
- Modify `packages/project-config/src/index.ts`
  - Export init helpers.
- Test `packages/project-config/__tests__/init.test.ts`
  - Unit-test id sanitization, YAML rendering, `.gitignore` idempotence, existing file refusal, `--force`, `--dry-run`, and `--no-gitignore` behavior.

### MCP binary / CLI

- Modify `packages/mcp/src/bin.ts`
  - Handle `cuekit init` before opening the database, like `cuekit tui --help`.
  - Parse `--dry-run`, `--force`, `--no-gitignore`, `--help`, and `-h`.
  - Call `runProjectConfigInit` from `@cuekit/project-config`.
  - Print a concise human-readable summary.
  - Exit with code 1 and a clear error when `.cuekit.yaml` exists without `--force`.
- Test `packages/mcp/__tests__/cli.test.ts`
  - Spawn `bun packages/mcp/src/bin.ts init ...` with temporary cwd.
  - Verify `.cuekit.yaml` and `.gitignore` output.
  - Verify `--dry-run` writes nothing.
  - Verify existing config refusal and `--force` overwrite.
  - Verify `cuekit init --help` works before opening DB.
  - Verify `CUEKIT_OPERATIONS` does not include `init`.

### Documentation

- Modify `README.md`
  - Mention `cuekit init` in the Project config section.
- Modify `docs/guides/project-config.md`
  - Replace or supplement manual `cp .cuekit.example.yaml .cuekit.yaml` with `cuekit init`.
  - Document generated files and options.
- Optional modify `.cuekit.example.yaml`
  - Keep as a more complete example; do not make `cuekit init` generate all example fields.

---

## Chunk 1: Project-config init helpers

### Task 1: Add deterministic init rendering helpers

**Files:**
- Create: `packages/project-config/src/init.ts`
- Modify: `packages/project-config/src/index.ts`
- Test: `packages/project-config/__tests__/init.test.ts`

- [ ] **Step 1: Write failing tests for safe project id derivation and YAML rendering**

Add tests like:

```ts
import { describe, expect, it } from "bun:test";
import { parse } from "yaml";
import { CuekitProjectConfigSchema } from "../src/schema.ts";
import { deriveProjectId, renderProjectConfigTemplate } from "../src/init.ts";

describe("deriveProjectId", () => {
  it("sanitizes directory names into valid project ids", () => {
    expect(deriveProjectId("My App!")).toBe("My-App");
    expect(deriveProjectId("!!!")).toBe("project");
  });
});

describe("renderProjectConfigTemplate", () => {
  it("renders safe config without submit defaults or bypass", () => {
    const text = renderProjectConfigTemplate({ projectId: "my-app", projectName: "My App" });
    expect(text).toContain("scope: project");
    expect(text).toContain("permissions: prompt");
    expect(text).not.toContain("permissions: bypass");
    expect(text).not.toContain("submit:");
    expect(text).not.toContain("delete-empty-team");
    const parsed = CuekitProjectConfigSchema.parse(parse(text));
    expect(parsed.project?.id).toBe("my-app");
    expect(parsed.project?.name).toBe("My App");
  });

  it("quotes YAML-sensitive generated project values", () => {
    const text = renderProjectConfigTemplate({ projectId: "project-123", projectName: "true: # app" });
    const parsed = CuekitProjectConfigSchema.parse(parse(text));
    expect(parsed.project?.id).toBe("project-123");
    expect(parsed.project?.name).toBe("true: # app");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test packages/project-config/__tests__/init.test.ts
```

Expected: FAIL because `init.ts` does not exist yet.

- [ ] **Step 3: Implement minimal rendering helpers**

In `packages/project-config/src/init.ts`, add a renderer that uses YAML-safe serialization. Do not concatenate unquoted user-derived values into YAML.

```ts
import { stringify } from "yaml";
import type { CuekitProjectConfig } from "./schema.ts";

export function deriveProjectId(name: string): string {
  const sanitized = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "project";
}

export interface RenderProjectConfigTemplateInput {
  projectId: string;
  projectName: string;
}

export function renderProjectConfigTemplate(input: RenderProjectConfigTemplateInput): string {
  const config: CuekitProjectConfig = {
    project: { id: input.projectId, name: input.projectName },
    tui: { scope: "project" },
    teams: { cleanup: "keep-team" },
    adapters: {
      "claude-code": { permissions: "prompt" },
      opencode: { permissions: "prompt" },
    },
  };
  return stringify(config);
}
```

Export from `packages/project-config/src/index.ts`.

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
bun test packages/project-config/__tests__/init.test.ts
bun run --filter @cuekit/project-config typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
but stage packages/project-config/src/init.ts packages/project-config/src/index.ts packages/project-config/__tests__/init.test.ts <branch>
but commit <branch> --only -m "Add project config init rendering" --status-after
```

### Task 2: Add `.gitignore` update and init execution helpers

**Files:**
- Modify: `packages/project-config/src/init.ts`
- Test: `packages/project-config/__tests__/init.test.ts`

- [ ] **Step 1: Write failing tests for `.gitignore` update behavior**

Cover:

- appends `.cuekit/tasks/` with comment when absent;
- does not duplicate existing `.cuekit/tasks/`;
- does not ignore `.cuekit/` as a whole;
- preserves existing content.

Example:

```ts
import { applyCuekitGitignoreEntry } from "../src/init.ts";

it("adds only .cuekit/tasks to gitignore", () => {
  const next = applyCuekitGitignoreEntry("dist/\n");
  expect(next).toContain("dist/\n");
  expect(next).toContain("# cuekit local task artifacts");
  expect(next).toContain(".cuekit/tasks/");
  expect(next).not.toContain(".cuekit/\n");
});
```

- [ ] **Step 2: Write failing tests for `runProjectConfigInit` filesystem behavior**

Use `mkdtempSync` and cover:

- creates `.cuekit.yaml` and `.gitignore`;
- refuses existing `.cuekit.yaml` without `force`;
- overwrites with `force`;
- `dryRun` writes nothing but reports intended writes;
- `gitignore: false` skips `.gitignore`.

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun test packages/project-config/__tests__/init.test.ts
```

Expected: FAIL for missing helpers.

- [ ] **Step 4: Implement helpers**

Add focused APIs:

```ts
export const CUEKIT_GITIGNORE_ENTRY = ".cuekit/tasks/";

export function applyCuekitGitignoreEntry(current: string): string { /* idempotent append */ }

export type ProjectConfigInitOptions = {
  cwd: string;
  dryRun?: boolean;
  force?: boolean;
  gitignore?: boolean;
};

export type ProjectConfigInitResult = {
  cwd: string;
  configPath: string;
  gitignorePath?: string;
  created: string[];
  updated: string[];
  skipped: string[];
  dryRun: boolean;
};

export function runProjectConfigInit(options: ProjectConfigInitOptions): ProjectConfigInitResult { /* fs implementation */ }
```

Implementation notes:

- Use `basename(resolve(cwd))` for project name.
- Write `.cuekit.yaml` only if absent or `force` is true.
- Treat `.gitignore` as updated only when content changes.
- In `dryRun`, return what would be created/updated but do not write.
- Throw `Error` with clear message for existing `.cuekit.yaml` without force.

- [ ] **Step 5: Run tests**

```bash
bun test packages/project-config/__tests__/init.test.ts
bun run --filter @cuekit/project-config typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
but stage packages/project-config/src/init.ts packages/project-config/__tests__/init.test.ts <branch>
but commit <branch> --only -m "Add project config init filesystem helpers" --status-after
```

---

## Chunk 2: Human CLI command

### Task 3: Wire `cuekit init` into the binary before DB startup

**Files:**
- Modify: `packages/mcp/src/bin.ts`
- Test: `packages/mcp/__tests__/cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Add tests that spawn the binary in a temporary directory:

```ts
it("serves init as a human-only command before opening the database", async () => {
  const tmpRoot = mkdtempSync(`${tmpdir()}/cuekit-init-`);
  try {
    const binPath = resolve(WORKSPACE_ROOT, "packages/mcp/src/bin.ts");
    const proc = Bun.spawn(["bun", binPath, "init"], {
      cwd: tmpRoot,
      env: { ...process.env, CUEKIT_DB_PATH: "/nonexistent-dir/cuekit/state.db" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain(".cuekit.yaml");
    expect(readFileSync(`${tmpRoot}/.cuekit.yaml`, "utf8")).toContain("scope: project");
    expect(readFileSync(`${tmpRoot}/.gitignore`, "utf8")).toContain(".cuekit/tasks/");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
```

Also add tests for:

- `cuekit init --help`;
- `cuekit init --dry-run` writes nothing;
- existing `.cuekit.yaml` exits non-zero without `--force`;
- `cuekit init --force` overwrites;
- `cuekit init --no-gitignore` skips `.gitignore`;
- `CUEKIT_OPERATIONS` has no `init` MCP operation or CLI path.

- [ ] **Step 2: Run tests to verify fail**

```bash
bun test packages/mcp/__tests__/cli.test.ts --grep "init"
```

Expected: FAIL because command is not wired.

- [ ] **Step 3: Implement option parsing and help in `bin.ts`**

Implement before database open:

```ts
const isInit = process.argv[2] === "init";
if (isInit && (process.argv.includes("--help") || process.argv.includes("-h"))) {
  printInitHelp();
  return;
}
if (isInit) {
  const result = runProjectConfigInit({
    cwd: process.cwd(),
    dryRun: process.argv.includes("--dry-run"),
    force: process.argv.includes("--force"),
    gitignore: !process.argv.includes("--no-gitignore"),
  });
  printInitSummary(result);
  return;
}
```

Handle errors in the existing catch block. Keep output human-readable and concise.

- [ ] **Step 4: Run tests**

```bash
bun test packages/mcp/__tests__/cli.test.ts --grep "init"
bun run --filter @cuekit/mcp typecheck
```

Expected: PASS.

- [ ] **Step 5: Run operation boundary test**

```bash
bun test packages/mcp/__tests__/cli.test.ts --grep "MCP names"
```

Expected: PASS and no `init` in `CUEKIT_OPERATIONS`.

- [ ] **Step 6: Commit**

```bash
but stage packages/mcp/src/bin.ts packages/mcp/__tests__/cli.test.ts <branch>
but commit <branch> --only -m "Add cuekit init CLI command" --status-after
```

---

## Chunk 3: Documentation and final validation

### Task 4: Document `cuekit init`

**Files:**
- Modify: `README.md`
- Modify: `docs/guides/project-config.md`

- [ ] **Step 1: Update README**

In the Project config section, show:

```sh
cuekit init
```

Mention that it creates `.cuekit.yaml` and adds `.cuekit/tasks/` to `.gitignore`.

- [ ] **Step 2: Update project config guide**

Document:

- `cuekit init` as recommended start;
- manual copy from `.cuekit.example.yaml` as an alternative;
- generated fields are intentionally minimal;
- options: `--dry-run`, `--force`, `--no-gitignore`;
- `.gitignore` behavior ignores only `.cuekit/tasks/`.

- [ ] **Step 3: Run validation**

```bash
bun run check
bun run typecheck
bun test packages/project-config/__tests__/init.test.ts packages/mcp/__tests__/cli.test.ts --grep "init"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
but stage README.md docs/guides/project-config.md <branch>
but commit <branch> --only -m "Document cuekit init" --status-after
```

### Task 5: Final review and PR

**Files:**
- All files touched by Tasks 1-4.

- [ ] **Step 1: Run full validation**

```bash
bun run check
bun run typecheck
bun test
```

Expected: all pass, no Biome warnings.

- [ ] **Step 2: Request code review**

Use the code-reviewer subagent with this focus:

```text
Review cuekit init implementation. Focus on safe config generation, .gitignore idempotence, no MCP exposure, no permission bypass, no delete-empty-team generation, and CLI error behavior.
```

Expected: no blocking issues.

- [ ] **Step 3: Create PR**

```bash
but pr new <branch> -F /tmp/pr-cuekit-init.md --status-after
```

PR body should include summary, tests, and `Closes #<issue>`.

- [ ] **Step 4: Merge PR after checks/review**

```bash
gh pr merge <number> --merge --delete-branch
```

Expected: merged to `main`; workspace clean after unapply/pull.
