# cuekit Project Config Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `.cuekit.yaml` as a safe project-local configuration file for project identity, TUI scoping, submit defaults, Task Teams defaults, and safe adapter permission defaults.

**Architecture:** Add a focused `@cuekit/project-config` package that owns YAML parsing, schema validation, discovery, and default application helpers. Store safe project identity on sessions so MCP/CLI/TUI can filter by config identity while preserving legacy path fallback. Apply configuration at command boundaries (`submit_task`, `submit_team_tasks`, `wait_team`, `cuekit tui`) with explicit-input precedence and security rules that prevent untrusted project config from silently enabling permission bypass or global TUI scope.

**Tech Stack:** TypeScript, Bun, Zod, SQLite migrations, `yaml` parser, existing `@cuekit/core` schemas, existing `@cuekit/store` persistence, existing `@cuekit/mcp` command registry, GitButler workflow.

---

## Source design

- Design doc: `docs/issues/cuekit-project-config-design.md`
- Current TUI project-scope implementation: `packages/mcp/src/tui-context.ts`, `packages/mcp/src/bin.ts`, `packages/core/src/task-list-filter.ts`, `packages/store/src/task-store.ts`
- Agent Profiles reference for package boundaries and discovery style: `packages/agent-profiles/src/*`
- Existing config-like reference: `/Users/kawasakiisao/Desktop/ai/isuner/.isuner.yaml`, `/Users/kawasakiisao/Desktop/ai/isuner/src/lib/config.ts`

## File map

### New package: `packages/project-config`

- Create `packages/project-config/package.json`
  - package name `@cuekit/project-config`
  - dependencies: `@cuekit/core`, `zod`, `yaml`
- Create `packages/project-config/tsconfig.json`
- Create `packages/project-config/src/schema.ts`
  - Zod schemas for `.cuekit.yaml`
  - public types: `CuekitProjectConfig`, `ProjectIdentity`, `TuiScope`, `SubmitDefaults`, `TeamDefaults`, `AdapterPermissionDefaults`
- Create `packages/project-config/src/discovery.ts`
  - upward search for `.cuekit.yaml`
  - fallback to Git/project root discovery behavior
  - safe identity derivation from `(config_root, project.id)`
- Create `packages/project-config/src/load.ts`
  - parse YAML, validate schema, return typed result or structured error string
- Create `packages/project-config/src/apply.ts`
  - helpers for applying submit defaults, team role defaults, wait defaults, and safe adapter permission defaults
- Create `packages/project-config/src/index.ts`
- Tests:
  - `packages/project-config/__tests__/schema.test.ts`
  - `packages/project-config/__tests__/discovery.test.ts`
  - `packages/project-config/__tests__/load.test.ts`
  - `packages/project-config/__tests__/apply.test.ts`

### Core/store changes

- Modify `packages/core/src/task-list-filter.ts`
  - add project identity filter fields needed by TUI and list tasks
- Modify `packages/store/src/sql/010-project-config-identity.sql`
  - add nullable session columns: `config_root`, `project_id`, `project_name`, `project_uid`
  - add indexes for `project_uid` and `(config_root, project_id)`
- Modify `packages/store/src/migrations.ts`
- Modify `packages/store/src/session.ts`
- Modify `packages/store/src/session-store.ts`
  - persist identity fields on `createSession`
- Modify `packages/store/src/task-store.ts`
  - list tasks by project identity
- Tests:
  - `packages/store/__tests__/migrate.test.ts`
  - `packages/store/__tests__/session-store.test.ts`
  - `packages/store/__tests__/task-store.test.ts`

### MCP / CLI changes

- Modify `packages/mcp/package.json`
  - add dependency on `@cuekit/project-config`
- Modify `packages/mcp/src/session-helpers.ts`
  - discover/load project config during session auto-create
  - persist identity fields
- Modify `packages/mcp/src/commands/submit-task.ts`
  - apply submit defaults with correct precedence and safe-permission rule
- Modify `packages/mcp/src/commands/submit-team-tasks.ts`
  - apply `teams.roles` when role omitted
  - reuse submit behavior for config-derived role defaults
- Modify `packages/mcp/src/commands/wait-team.ts`
  - apply `teams.wait` defaults
- Modify `packages/mcp/src/tui-context.ts`
  - support config project identity filtering
- Modify `packages/mcp/src/bin.ts`
  - load `.cuekit.yaml` for `cuekit tui`
  - support `--path` and `--all` overrides
  - reject project-local `tui.scope: all`
- Tests:
  - `packages/mcp/__tests__/commands.test.ts`
  - `packages/mcp/__tests__/cli.test.ts`
  - `packages/mcp/__tests__/tui-context.test.ts`

### Docs/examples

- Create `.cuekit.example.yaml`
- Modify `README.md`
- Modify `docs/README.md`
- Modify `docs/issues/cuekit-project-config-design.md` only if implementation clarifies design details

---

## Chunk 1: Config package and schema

### Task 1: Add `@cuekit/project-config` package skeleton and schemas

**GitHub issue title:** `Add project config package and schema`

**Files:**
- Create: `packages/project-config/package.json`
- Create: `packages/project-config/tsconfig.json`
- Create: `packages/project-config/src/schema.ts`
- Create: `packages/project-config/src/index.ts`
- Test: `packages/project-config/__tests__/schema.test.ts`
- Modify: `package.json` only if workspace/package tooling requires explicit references

- [ ] **Step 1: Write failing schema tests**

Create `packages/project-config/__tests__/schema.test.ts` covering:

```ts
import { describe, expect, it } from "bun:test";
import { CuekitProjectConfigSchema } from "../src/schema.ts";

describe("CuekitProjectConfigSchema", () => {
  it("accepts the recommended config shape", () => {
    const parsed = CuekitProjectConfigSchema.parse({
      project: { id: "cuekit", name: "cuekit" },
      tui: { scope: "project" },
      submit: {
        role: "worker",
        agent: "claude-code",
        model: "sonnet",
        timeout_ms: 300000,
        priority: "normal",
      },
      teams: {
        roles: {
          coordinator: "planner",
          worker: "worker",
          reviewer: "reviewer",
          observer: "scout",
        },
        cleanup: "keep-team",
        wait: { timeout_ms: 300000, poll_interval_ms: 2000 },
      },
      adapters: {
        "claude-code": { permissions: "prompt" },
        opencode: { permissions: "prompt" },
      },
    });
    expect(parsed.project?.id).toBe("cuekit");
  });

  it("rejects project-local tui.scope all", () => {
    expect(() => CuekitProjectConfigSchema.parse({ tui: { scope: "all" } })).toThrow();
  });

  it("rejects project-local permission bypass", () => {
    expect(() =>
      CuekitProjectConfigSchema.parse({ adapters: { "claude-code": { permissions: "bypass" } } }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test packages/project-config/__tests__/schema.test.ts
```

Expected: FAIL because package/files do not exist.

- [ ] **Step 3: Add package skeleton**

Create `packages/project-config/package.json`:

```json
{
  "name": "@cuekit/project-config",
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
    "@cuekit/core": "workspace:*",
    "yaml": "^2.6.0",
    "zod": "^3.25.0"
  }
}
```

Create `packages/project-config/tsconfig.json` following the pattern in `packages/agent-profiles/tsconfig.json`.

- [ ] **Step 4: Implement schemas**

Create `packages/project-config/src/schema.ts` with:

```ts
import { z } from "zod";

export const ProjectIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/);
export const TuiScopeSchema = z.enum(["project", "path"]);
export const TeamCleanupSchema = z.enum(["keep-team", "delete-empty-team"]);
export const AdapterPermissionSchema = z.enum(["prompt"]);

export const CuekitProjectConfigSchema = z
  .object({
    project: z
      .object({
        id: ProjectIdSchema.optional(),
        name: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    tui: z.object({ scope: TuiScopeSchema.optional() }).strict().optional(),
    submit: z
      .object({
        role: z.string().min(1).optional(),
        agent: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        timeout_ms: z.number().int().positive().optional(),
        priority: z.enum(["low", "normal", "high"]).optional(),
      })
      .strict()
      .optional(),
    teams: z
      .object({
        roles: z
          .object({
            coordinator: z.string().min(1).optional(),
            worker: z.string().min(1).optional(),
            reviewer: z.string().min(1).optional(),
            observer: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
        cleanup: TeamCleanupSchema.optional(),
        wait: z
          .object({
            timeout_ms: z.number().int().min(0).optional(),
            poll_interval_ms: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    adapters: z.record(z.string().min(1), z.object({ permissions: AdapterPermissionSchema.optional() }).strict()).optional(),
  })
  .strict();

export type CuekitProjectConfig = z.infer<typeof CuekitProjectConfigSchema>;
export type TuiScope = z.infer<typeof TuiScopeSchema>;
```

Create `packages/project-config/src/index.ts` exporting schema APIs.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
bun test packages/project-config/__tests__/schema.test.ts
bun run --filter @cuekit/project-config typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
but stage packages/project-config/package.json project-config-schema
but stage packages/project-config/tsconfig.json project-config-schema
but stage packages/project-config/src/schema.ts project-config-schema
but stage packages/project-config/src/index.ts project-config-schema
but stage packages/project-config/__tests__/schema.test.ts project-config-schema
but commit project-config-schema --only -m "Add project config schema" --status-after
```

### Task 2: Add config discovery and YAML loading

**GitHub issue title:** `Add project config discovery and YAML loading`

**Files:**
- Create: `packages/project-config/src/discovery.ts`
- Create: `packages/project-config/src/load.ts`
- Modify: `packages/project-config/src/index.ts`
- Test: `packages/project-config/__tests__/discovery.test.ts`
- Test: `packages/project-config/__tests__/load.test.ts`

- [ ] **Step 1: Write failing discovery tests**

Cover:

- finds nearest parent `.cuekit.yaml`;
- falls back to Git root when no config exists;
- falls back to cwd when neither exists;
- derives stable safe identity using config root + project id;
- derives a safe identity when `.cuekit.yaml` exists but `project.id` is omitted, using a stable path-derived project id such as the config root basename or an internal path token;
- always produces `project_uid` when config exists, even when `project.id` is omitted;
- different config roots with same `project.id` produce different `project_uid`.

- [ ] **Step 2: Write failing load tests**

Cover:

- parses valid YAML;
- returns clear error for malformed YAML;
- returns clear error for invalid schema such as `tui.scope: all`;
- missing config returns `{ config: {}, configPath: undefined }` or equivalent no-config result.

- [ ] **Step 3: Run tests to verify failures**

```bash
bun test packages/project-config/__tests__/discovery.test.ts packages/project-config/__tests__/load.test.ts
```

Expected: FAIL because files/functions do not exist.

- [ ] **Step 4: Implement discovery**

`packages/project-config/src/discovery.ts` should expose focused functions:

```ts
export interface ProjectConfigDiscovery {
  cwd: string;
  configPath?: string;
  configRoot: string;
  projectRoot: string;
  source: "config" | "git" | "cwd";
}

export interface ProjectIdentity {
  config_root?: string;
  project_id?: string;
  project_name?: string;
  project_uid?: string;
  project_root: string;
}
```

Use a SHA-256 hash or deterministic base64url/hex digest for `project_uid`, derived from `${configRoot}\0${effectiveProjectId}`. Keep it opaque. `effectiveProjectId` is `config.project.id` when present; otherwise derive a stable path-based id from the config root (for example the basename plus a path hash). Do not hash the literal string `undefined`.

- [ ] **Step 5: Implement YAML loading**

`packages/project-config/src/load.ts` should use `yaml` parser and `CuekitProjectConfigSchema.safeParse`. Return discriminated result:

```ts
export type LoadProjectConfigResult =
  | { ok: true; config: CuekitProjectConfig; discovery: ProjectConfigDiscovery; identity: ProjectIdentity }
  | { ok: false; error: string; path?: string };
```

Do not silently ignore malformed found config.

- [ ] **Step 6: Run tests and typecheck**

```bash
bun test packages/project-config/__tests__/discovery.test.ts packages/project-config/__tests__/load.test.ts
bun run --filter @cuekit/project-config typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
but stage packages/project-config/src/discovery.ts project-config-discovery
but stage packages/project-config/src/load.ts project-config-discovery
but stage packages/project-config/src/index.ts project-config-discovery
but stage packages/project-config/__tests__/discovery.test.ts project-config-discovery
but stage packages/project-config/__tests__/load.test.ts project-config-discovery
but commit project-config-discovery --only -m "Add project config discovery" --status-after
```

---

## Chunk 2: Persistence and task filtering

### Task 3: Persist project config identity on sessions

**GitHub issue title:** `Persist project config identity on sessions`

**Files:**
- Create: `packages/store/src/sql/010-project-config-identity.sql`
- Modify: `packages/store/src/migrations.ts`
- Modify: `packages/store/src/session.ts`
- Modify: `packages/store/src/session-store.ts`
- Test: `packages/store/__tests__/migrate.test.ts`
- Test: `packages/store/__tests__/session-store.test.ts`

- [ ] **Step 1: Write failing migration tests**

Add tests asserting `sessions` has nullable columns:

- `config_root`
- `project_id`
- `project_name`
- `project_uid`

and indexes:

- `idx_sessions_project_uid`
- `idx_sessions_config_project`

- [ ] **Step 2: Write failing store tests**

Add `createSession` tests that persist and read identity fields.

- [ ] **Step 3: Run tests to verify failures**

```bash
bun test packages/store/__tests__/migrate.test.ts packages/store/__tests__/session-store.test.ts
```

Expected: FAIL due missing columns/types.

- [ ] **Step 4: Add migration**

Create SQL migration:

```sql
alter table sessions add column config_root text;
alter table sessions add column project_id text;
alter table sessions add column project_name text;
alter table sessions add column project_uid text;
create index if not exists idx_sessions_project_uid on sessions(project_uid);
create index if not exists idx_sessions_config_project on sessions(config_root, project_id);
```

- [ ] **Step 5: Update store schemas and create input**

Add nullable fields to `SessionSchema`. Add optional fields to `CreateSessionInput`. Persist them in insert.

- [ ] **Step 6: Run tests and typecheck**

```bash
bun test packages/store/__tests__/migrate.test.ts packages/store/__tests__/session-store.test.ts
bun run --filter @cuekit/store typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
but stage packages/store/src/sql/010-project-config-identity.sql project-config-session-identity
but stage packages/store/src/migrations.ts project-config-session-identity
but stage packages/store/src/session.ts project-config-session-identity
but stage packages/store/src/session-store.ts project-config-session-identity
but stage packages/store/__tests__/migrate.test.ts project-config-session-identity
but stage packages/store/__tests__/session-store.test.ts project-config-session-identity
but commit project-config-session-identity --only -m "Persist project config identity" --status-after
```

### Task 4: Add project identity task-list filtering

**GitHub issue title:** `Filter tasks by project config identity`

**Files:**
- Modify: `packages/core/src/task-list-filter.ts`
- Modify: `packages/store/src/task-store.ts`
- Modify: `packages/tui/src/data.ts`
- Test: `packages/store/__tests__/task-store.test.ts`

- [ ] **Step 1: Write failing task-store tests**

Add tests for:

- `listTasks(db, { project_uid: "..." })` returns matching sessions only;
- legacy fallback can still use `project_root` or existing `project_root` filter;
- `project_uid` filter can include multiple sessions from the same safe identity if they share it intentionally;
- `listTasks(db, { project_scope: { project_uid: "uid", legacy_project_root: "/repo" } })` returns rows matching either `sessions.project_uid = "uid"` OR legacy `sessions.project_root = "/repo"`;
- `project_scope` does not accidentally include rows with the same human `project_id` but different `config_root` / `project_uid`.

- [ ] **Step 2: Run tests to verify failures**

```bash
bun test packages/store/__tests__/task-store.test.ts --grep "project"
```

Expected: FAIL due missing filter.

- [ ] **Step 3: Update core filter schema**

Add optional fields as needed, but include an explicit project-scope filter capable of OR semantics:

```ts
project_uid?: string;
config_root?: string;
project_id?: string;
project_root?: string;
project_scope?: {
  project_uid?: string;
  config_root?: string;
  project_id?: string;
  legacy_project_root?: string;
};
```

Prefer `project_scope` for TUI/default project matching. It must match the safe identity and include legacy rows with `sessions.project_root = legacy_project_root` using OR semantics. Keep `project_root` for path fallback. If `project_root` already exists from current work, preserve compatibility.

- [ ] **Step 4: Update `listTasks` SQL**

Join `sessions` when any session-scoped filter is present. Add named-parameter conditions for project identity. Avoid positional binding order hazards.

- [ ] **Step 5: Run tests and typecheck**

```bash
bun test packages/store/__tests__/task-store.test.ts --grep "project"
bun run --filter @cuekit/core typecheck
bun run --filter @cuekit/store typecheck
bun run --filter @cuekit/tui typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
but stage packages/core/src/task-list-filter.ts project-config-task-filter
but stage packages/store/src/task-store.ts project-config-task-filter
but stage packages/tui/src/data.ts project-config-task-filter
but stage packages/store/__tests__/task-store.test.ts project-config-task-filter
but commit project-config-task-filter --only -m "Filter tasks by project identity" --status-after
```

---

## Chunk 3: Session creation and TUI scope

### Task 5: Apply project config identity during session resolution

**GitHub issue title:** `Apply project config identity during session creation`

**Files:**
- Modify: `packages/mcp/package.json`
- Modify: `packages/mcp/src/session-helpers.ts`
- Test: `packages/mcp/__tests__/commands.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests showing:

- `submit_task({ cwd })` under a directory with `.cuekit.yaml` creates a session with `config_root`, `project_id`, `project_name`, `project_uid`.
- malformed `.cuekit.yaml` returns structured `invalid_input` rather than creating a session.

- [ ] **Step 2: Run tests to verify failures**

```bash
bun test packages/mcp/__tests__/commands.test.ts --grep "project config"
```

Expected: FAIL due missing config integration.

- [ ] **Step 3: Wire project config package into MCP**

Add `@cuekit/project-config` to `packages/mcp/package.json`.

- [ ] **Step 4: Update session helper**

`resolveSessionId` currently returns a string and may auto-create sessions. Introduce a structured helper if needed:

```ts
resolveSession(ctx, { session_id, cwd }): { ok: true; session_id: string; config?: LoadedProjectConfig } | { ok: false; error: JobError }
```

If too large, add a minimal `resolveSessionIdWithProjectConfig` and migrate `submit_task` first.

- [ ] **Step 5: Preserve explicit session behavior**

If `session_id` is explicitly provided, do not mutate that session's identity. Use the session's stored worktree for profile discovery as today.

- [ ] **Step 6: Run tests and typecheck**

```bash
bun test packages/mcp/__tests__/commands.test.ts --grep "project config"
bun run --filter @cuekit/mcp typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
but stage packages/mcp/package.json project-config-session-create
but stage packages/mcp/src/session-helpers.ts project-config-session-create
but stage packages/mcp/__tests__/commands.test.ts project-config-session-create
but commit project-config-session-create --only -m "Apply project config to sessions" --status-after
```

### Task 6: Make TUI use config project scope by default

**GitHub issue title:** `Make TUI use project config scope`

**Files:**
- Modify: `packages/mcp/src/tui-context.ts`
- Modify: `packages/mcp/src/bin.ts`
- Test: `packages/mcp/__tests__/tui-context.test.ts`
- Test: `packages/mcp/__tests__/cli.test.ts`

- [ ] **Step 1: Write failing TUI context tests**

Cover:

- default `cuekit tui` project scope uses `project_scope` when config exists;
- legacy sessions without `project_uid` but with matching `project_root = configRoot` still appear via OR fallback;
- `--path` uses path/Git root scope, ignoring YAML project identity;
- `--all` shows global tasks;
- project-local `tui.scope: path` changes default scope to path;
- project-local `tui.scope: all` is rejected by schema from Task 1.

- [ ] **Step 2: Run tests to verify failures**

```bash
bun test packages/mcp/__tests__/tui-context.test.ts packages/mcp/__tests__/cli.test.ts --grep "tui"
```

Expected: FAIL for config project scope cases.

- [ ] **Step 3: Update TUI context**

Let `createTuiContext` accept a scope object like:

```ts
type TuiScope =
  | { kind: "project"; project_scope: { project_uid?: string; config_root?: string; project_id?: string; legacy_project_root?: string } }
  | { kind: "path"; project_root: string }
  | { kind: "all" };
```

Translate it to `listTasks` filters.

- [ ] **Step 4: Update bin parsing**

Support:

```bash
cuekit tui
cuekit tui --path
cuekit tui --all
```

`--all` and `--path` override `.cuekit.yaml`. Without flags, use `tui.scope` or `project`.

- [ ] **Step 5: Run tests and typecheck**

```bash
bun test packages/mcp/__tests__/tui-context.test.ts packages/mcp/__tests__/cli.test.ts --grep "tui"
bun run --filter @cuekit/mcp typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
but stage packages/mcp/src/tui-context.ts project-config-tui-scope
but stage packages/mcp/src/bin.ts project-config-tui-scope
but stage packages/mcp/__tests__/tui-context.test.ts project-config-tui-scope
but stage packages/mcp/__tests__/cli.test.ts project-config-tui-scope
but commit project-config-tui-scope --only -m "Scope TUI with project config" --status-after
```

---

## Chunk 4: Submit and Task Teams defaults

### Task 7: Apply submit defaults and safe permission rules

**GitHub issue title:** `Apply project config submit defaults safely`

**Files:**
- Modify: `packages/project-config/src/apply.ts`
- Modify: `packages/project-config/src/index.ts`
- Modify: `packages/mcp/src/commands/submit-task.ts`
- Test: `packages/project-config/__tests__/apply.test.ts`
- Test: `packages/mcp/__tests__/commands.test.ts`
- Test: `packages/adapters/__tests__/claude-code-launch.test.ts` or existing adapter-options tests if needed

- [ ] **Step 1: Write failing apply tests**

Cover merge algorithm:

- explicit role wins over config `submit.role`;
- config role is used when role omitted;
- profile `agent_kind` wins over config `submit.agent`;
- config `submit.agent` fills only when no profile/explicit value exists;
- config `submit.model` fills only when no profile/explicit value exists;
- config-selected role forces `adapter_options.dangerously_skip_permissions = false` unless explicit adapter options set it;
- config-provided `submit.agent` forces `adapter_options.dangerously_skip_permissions = false` unless explicit adapter options set it, because project config selected executable runtime behavior;
- `adapters.<agent>.permissions: prompt` sets `adapter_options.dangerously_skip_permissions = false` when explicit adapter options are omitted, even when role is explicit or absent;
- config `submit.role` selecting a profile whose own adapter options request `dangerously_skip_permissions: true` must force false or reject unless caller explicitly supplies adapter options.

- [ ] **Step 2: Write failing command tests**

Use a temp `.cuekit.yaml` and `runSubmitTask`:

- omitted role uses `submit.role`;
- omitted timeout/priority use config defaults;
- explicit input overrides config;
- project-selected role forces safe permissions in persisted `spec_json`;
- `adapters.claude-code.permissions: prompt` forces safe permissions even when `submit.role` is not involved;
- unsafe adapter options from a project-selected profile do not survive into persisted `spec_json` unless explicitly provided by the submit caller.

- [ ] **Step 3: Run tests to verify failures**

```bash
bun test packages/project-config/__tests__/apply.test.ts packages/mcp/__tests__/commands.test.ts --grep "submit defaults"
```

Expected: FAIL.

- [ ] **Step 4: Implement pure apply helpers**

Create helpers that take explicit input/config/profile result and return a patch. Keep helpers free of DB/MCP dependencies.

- [ ] **Step 5: Integrate into `runSubmitTask`**

Be careful with ordering:

1. parse input;
2. resolve/create session and load config;
3. compute role selector from explicit/config;
4. resolve Agent Profile;
5. compute final spec using explicit > profile > config > built-in;
6. enforce safe permission rules from project config: project-selected roles, project-selected agents from `submit.agent`, and project `adapters.*.permissions: prompt` must set `dangerously_skip_permissions: false` unless the submit caller explicitly supplied adapter options. Strip or override unsafe profile-provided adapter options when the profile was selected only by project config.

- [ ] **Step 6: Run tests and typecheck**

```bash
bun test packages/project-config/__tests__/apply.test.ts packages/mcp/__tests__/commands.test.ts --grep "submit defaults"
bun run --filter @cuekit/project-config typecheck
bun run --filter @cuekit/mcp typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
but stage packages/project-config/src/apply.ts project-config-submit-defaults
but stage packages/project-config/src/index.ts project-config-submit-defaults
but stage packages/project-config/__tests__/apply.test.ts project-config-submit-defaults
but stage packages/mcp/src/commands/submit-task.ts project-config-submit-defaults
but stage packages/mcp/__tests__/commands.test.ts project-config-submit-defaults
but stage packages/adapters/__tests__/claude-code-launch.test.ts project-config-submit-defaults
but commit project-config-submit-defaults --only -m "Apply project submit defaults safely" --status-after
```

### Task 8: Apply Task Teams defaults

**GitHub issue title:** `Apply project config Task Teams defaults`

**Files:**
- Modify: `packages/project-config/src/apply.ts`
- Modify: `packages/mcp/src/commands/submit-team-tasks.ts`
- Modify: `packages/mcp/src/commands/wait-team.ts`
- Test: `packages/project-config/__tests__/apply.test.ts`
- Test: `packages/mcp/__tests__/commands.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:

- `submit_team_tasks` uses `teams.roles.worker` when position is `worker` and role omitted;
- explicit per-task role wins over `teams.roles`;
- `teams.roles.coordinator` maps coordinator to planner;
- roles derived from `teams.roles` preserve project-config provenance and trigger the same safe-permission enforcement as `submit.role`;
- `wait_team` uses `teams.wait.timeout_ms` and `poll_interval_ms` when omitted;
- explicit wait inputs override config.

- [ ] **Step 2: Run tests to verify failures**

```bash
bun test packages/project-config/__tests__/apply.test.ts packages/mcp/__tests__/commands.test.ts --grep "team defaults"
```

Expected: FAIL.

- [ ] **Step 3: Implement team role helpers**

In `packages/project-config/src/apply.ts`, expose:

```ts
roleForTeamPosition(config, position): string | undefined
applyWaitTeamDefaults(config, input): input
```

- [ ] **Step 4: Integrate `submit_team_tasks`**

Before calling `runSubmitTask`, if task has `position` and no `role`, derive role from config team roles while preserving provenance. Do not pass it as indistinguishable explicit user input. Use one of these implementation approaches:

- add an internal-only submit option such as `role_source_hint: "project-config"` that is not exposed in MCP schemas; or
- call a shared project-config submit resolver that returns both the effective role and `roleFromProjectConfig: true`.

Let `runSubmitTask` handle profile resolution and safety rules using that provenance so `teams.roles` cannot bypass safe-permission enforcement.

- [ ] **Step 5: Integrate `wait_team`**

Load config using the team's session worktree/config identity. Apply `teams.wait` defaults only when input values are omitted.

Do not implement `teams.cleanup: delete-empty-team` until a `delete_team` operation exists.

- [ ] **Step 6: Run tests and typecheck**

```bash
bun test packages/project-config/__tests__/apply.test.ts packages/mcp/__tests__/commands.test.ts --grep "team defaults"
bun run --filter @cuekit/project-config typecheck
bun run --filter @cuekit/mcp typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
but stage packages/project-config/src/apply.ts project-config-team-defaults
but stage packages/project-config/__tests__/apply.test.ts project-config-team-defaults
but stage packages/mcp/src/commands/submit-team-tasks.ts project-config-team-defaults
but stage packages/mcp/src/commands/wait-team.ts project-config-team-defaults
but stage packages/mcp/__tests__/commands.test.ts project-config-team-defaults
but commit project-config-team-defaults --only -m "Apply project team defaults" --status-after
```

---

## Chunk 5: Docs, examples, validation

### Task 9: Document `.cuekit.yaml` and add example config

**GitHub issue title:** `Document cuekit project config`

**Files:**
- Create: `.cuekit.example.yaml`
- Create: `docs/guides/project-config.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Test: optionally add docs smoke test if current docs tests exist

- [ ] **Step 1: Add example config**

Create `.cuekit.example.yaml` using the safe example:

```yaml
project:
  id: cuekit
  name: cuekit

tui:
  scope: project

submit:
  role: worker
  agent: claude-code
  model: sonnet
  timeout_ms: 300000
  priority: normal

teams:
  roles:
    coordinator: planner
    worker: worker
    reviewer: reviewer
    observer: scout
  cleanup: keep-team
  wait:
    timeout_ms: 300000
    poll_interval_ms: 2000

adapters:
  claude-code:
    permissions: prompt
  opencode:
    permissions: prompt
```

- [ ] **Step 2: Add guide**

Document:

- where `.cuekit.yaml` is searched;
- safe project identity;
- TUI scope behavior and CLI overrides;
- submit defaults and precedence;
- team defaults;
- adapter permission safety;
- what is intentionally not implemented (`teams.cleanup: delete-empty-team` until `delete_team`).

- [ ] **Step 3: Update docs index and README**

Link the guide from `docs/README.md` and add a short README section.

- [ ] **Step 4: Run validation**

```bash
bun run typecheck
bun run check
bun run test
```

Expected: PASS, except known Biome schema-version info and broken symlink warnings for `bun run check`.

- [ ] **Step 5: Commit**

```bash
but stage .cuekit.example.yaml project-config-docs
but stage docs/guides/project-config.md project-config-docs
but stage README.md project-config-docs
but stage docs/README.md project-config-docs
but commit project-config-docs --only -m "Document cuekit project config" --status-after
```

## Final validation for the full implementation

After all tasks land, run:

```bash
bun run typecheck
bun run test
bun run check
```

Expected:

- `typecheck`: pass
- `test`: pass
- `check`: no errors; existing Biome schema-version info and broken symlink warnings may remain if still present

Manual smoke flows:

```bash
cp .cuekit.example.yaml .cuekit.yaml
bun packages/mcp/src/bin.ts tui --help
bun packages/mcp/src/bin.ts team create --cwd "$PWD" --title "config smoke" --objective "config smoke" --format json
bun packages/mcp/src/bin.ts task submit --objective "config smoke" --format json
bun packages/mcp/src/bin.ts team submit --team_id <team_id> --tasks '[{"objective":"worker smoke","position":"worker"}]' --format json
```

Then verify:

- created sessions have project identity fields;
- task spec JSON includes config-derived defaults only when omitted;
- project-config-selected role runs with safe permission override unless explicit input opts into bypass;
- `cuekit tui` shows current project tasks;
- `cuekit tui --all` still shows global tasks.
