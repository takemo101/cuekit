# Agent Profiles Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cuekit agent profiles so callers can submit tasks by role, resolve `agent_kind`/`model` from Markdown profile definitions, and optionally let cuekit choose a role automatically.

**Architecture:** Implement profile parsing/discovery/merge/selection in a dedicated `@cuekit/agent-profiles` package. `@cuekit/mcp` resolves session/cwd context, calls the profile package, resolves submit input into a strict `TaskSpec`, and persists role metadata for status/TUI. `@cuekit/adapters` renders profile instructions into child prompts while keeping cuekit's child reporting contract final and non-overridable.

**Tech Stack:** Bun workspaces, TypeScript, `incur`/Zod schemas, SQLite migrations via `@cuekit/store`, existing MCP command framework, OpenTUI React UI.

---

## Source design

- Design doc: `docs/issues/cuekit-agent-profiles-design.md`
- Inspiration: `pi-subagents` profile files with frontmatter metadata + Markdown instruction body.

## File map

### New package

- Create `packages/agent-profiles/package.json` — workspace metadata for `@cuekit/agent-profiles`.
- Create `packages/agent-profiles/tsconfig.json` — TypeScript project config.
- Create `packages/agent-profiles/src/index.ts` — public exports.
- Create `packages/agent-profiles/src/schema.ts` — profile source/resolved schemas and public types.
- Create `packages/agent-profiles/src/frontmatter.ts` — Markdown frontmatter/body parser.
- Create `packages/agent-profiles/src/builtins.ts` — embedded builtin profile Markdown strings.
- Create `packages/agent-profiles/src/merge.ts` — duplicate validation and builtin/user/project override merge.
- Create `packages/agent-profiles/src/project-root.ts` — cwd/project-root anchoring, no store/session dependency.
- Create `packages/agent-profiles/src/discovery.ts` — load builtin/user/project profiles.
- Create `packages/agent-profiles/src/selection.ts` — deterministic `role: "auto"` selector.
- Create `packages/agent-profiles/__tests__/*.test.ts` — parser/discovery/merge/selection tests.

### Existing packages

- Modify `packages/core/src/task-spec.ts` — add optional role metadata fields.
- Modify `packages/core/src/task-summary.ts` / `task-status-view.ts` if status/list should expose role metadata.
- Modify `packages/store/src/task.ts` — task row schema includes role columns.
- Modify `packages/store/src/task-store.ts` — create/update/list row mapping includes role columns.
- Modify store migrations under `packages/store/src` — add nullable `role`, `role_source`, `role_selection_reason` columns.
- Modify `packages/mcp/package.json` — depend on `@cuekit/agent-profiles`.
- Modify `packages/mcp/src/commands/submit-task.ts` — resolve role/profile before adapter validation/submission.
- Create `packages/mcp/src/commands/list-agent-profiles.ts` — MCP/CLI discovery command.
- Modify `packages/mcp/src/operations.ts` — register `list_agent_profiles`.
- Modify `packages/adapters/src/task-spec-prompt.ts` — inject role instructions before final reporting contract.
- Modify `packages/tui/src/data.ts` and `packages/tui/src/components/task-detail.tsx` — show role/model/source metadata.
- Update package and integration tests across `packages/*/__tests__`.

---

## Chunk 1: Add `@cuekit/agent-profiles` package skeleton and schemas

### Task 1: Workspace package skeleton

**Files:**
- Create: `packages/agent-profiles/package.json`
- Create: `packages/agent-profiles/tsconfig.json`
- Create: `packages/agent-profiles/src/index.ts`
- Create: `packages/agent-profiles/src/schema.ts`
- Create: `packages/agent-profiles/__tests__/schema.test.ts`

- [ ] **Step 1: Write schema tests**

Create tests that validate:
- `AgentProfileFileSchema` accepts partial override files with `id` only plus instructions.
- `ResolvedAgentProfileSchema` requires `description` and `instructions` after merge.
- `instructions_mode` defaults to `replace`.
- `id: "auto"` is rejected.

- [ ] **Step 2: Run failing tests**

Run:

```bash
bun test packages/agent-profiles/__tests__/schema.test.ts
```

Expected: fails because package/files do not exist yet.

- [ ] **Step 3: Create package and schemas**

Implement:

```ts
type AgentProfileSource = "builtin" | "user" | "project";
type InstructionsMode = "replace" | "append";
```

Schemas should represent both source file shape and resolved shape.

- [ ] **Step 4: Export public types**

`packages/agent-profiles/src/index.ts` should export schemas and types.

- [ ] **Step 5: Validate**

Run:

```bash
bun test packages/agent-profiles/__tests__/schema.test.ts
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
but commit agent-profiles-impl -m "feat: add agent profiles package schema" --status-after
```

---

## Chunk 2: Parse Markdown profile files

### Task 2: Frontmatter parser

**Files:**
- Create: `packages/agent-profiles/src/frontmatter.ts`
- Create: `packages/agent-profiles/__tests__/frontmatter.test.ts`

- [ ] **Step 1: Write parser tests**

Cover:
- frontmatter + body
- no frontmatter
- quoted scalar values
- tags as YAML list
- tags as comma-separated string if supported
- malformed/unterminated frontmatter returns a structured parse error

- [ ] **Step 2: Run failing tests**

```bash
bun test packages/agent-profiles/__tests__/frontmatter.test.ts
```

- [ ] **Step 3: Implement parser**

Keep parser small and deterministic. It does not need full YAML support, but must support the fields needed by builtin/profile files.

- [ ] **Step 4: Validate**

```bash
bun test packages/agent-profiles/__tests__/frontmatter.test.ts
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
but commit agent-profiles-impl -m "feat: parse agent profile frontmatter" --status-after
```

---

## Chunk 3: Builtins, merge, and discovery

### Task 3: Builtin profiles and override merge

**Files:**
- Create: `packages/agent-profiles/src/builtins.ts`
- Create: `packages/agent-profiles/src/merge.ts`
- Create: `packages/agent-profiles/__tests__/merge.test.ts`

- [ ] **Step 1: Write merge tests**

Cover:
- builtin only resolves all required fields
- user overrides builtin model
- project overrides user and builtin
- `instructions_mode: replace`
- `instructions_mode: append`
- duplicate ids inside same scope fail with conflicting paths
- `id: auto` fails

- [ ] **Step 2: Implement builtin profiles**

Include at least:
- `worker`
- `reviewer`
- `planner`
- `scout`
- `debugger`
- `docs-writer`

Use `agent_kind: claude-code` and model names compatible with current adapter capabilities (`haiku`, `sonnet`, `opus`).

- [ ] **Step 3: Implement merge**

Merge order: `builtin -> user -> project`.

- [ ] **Step 4: Validate**

```bash
bun test packages/agent-profiles/__tests__/merge.test.ts
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
but commit agent-profiles-impl -m "feat: merge agent profile overrides" --status-after
```

### Task 4: File discovery and project root anchoring

**Files:**
- Create: `packages/agent-profiles/src/project-root.ts`
- Create: `packages/agent-profiles/src/discovery.ts`
- Create: `packages/agent-profiles/__tests__/discovery.test.ts`

- [ ] **Step 1: Write discovery tests**

Use temporary directories. Cover:
- builtin only
- user profile directory missing is not an error
- project profile directory missing is not an error
- project `.cuekit/agents/*.md` discovered from nested cwd
- `.git` directory and `.git` file both anchor project root
- relative cwd normalized
- same-scope duplicate ids fail deterministically

Do not test `session_id` here. The package must not import store/session code.

- [ ] **Step 2: Implement project root helper**

Accept resolved cwd/project root inputs only. Do not depend on `@cuekit/store`.

- [ ] **Step 3: Implement discovery**

Inputs should include:

```ts
{
  cwd?: string;
  userProfilesDir?: string;
  scope?: "all" | "builtin" | "user" | "project";
}
```

- [ ] **Step 4: Validate**

```bash
bun test packages/agent-profiles/__tests__/discovery.test.ts
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
but commit agent-profiles-impl -m "feat: discover agent profile files" --status-after
```

---

## Chunk 4: Deterministic automatic profile selection

### Task 5: Rule-based selector

**Files:**
- Create: `packages/agent-profiles/src/selection.ts`
- Create: `packages/agent-profiles/__tests__/selection.test.ts`

- [ ] **Step 1: Write selector tests**

Cover keyword mappings:
- review/diff/PR -> `reviewer`
- plan/design/spec -> `planner`
- bug/debug/failing/test failure -> `debugger`
- docs/README/changelog -> `docs-writer`
- inspect/explore/understand/map -> `scout`
- fallback -> `worker`
- missing preferred profile falls back to `worker` or first available profile with a reason

- [ ] **Step 2: Implement selector**

Return both profile id and reason:

```ts
{ role: "debugger", reason: "matched keyword: failing" }
```

- [ ] **Step 3: Validate**

```bash
bun test packages/agent-profiles/__tests__/selection.test.ts
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
but commit agent-profiles-impl -m "feat: select agent profiles automatically" --status-after
```

---

## Chunk 5: Persist role metadata in core/store

### Task 6: Core TaskSpec role fields

**Files:**
- Modify: `packages/core/src/task-spec.ts`
- Modify: `packages/core/__tests__/schemas.test.ts`

- [ ] **Step 1: Write schema tests**

Cover optional fields:
- `role`
- `role_instructions`
- `role_source`
- `role_sources`
- `role_selection_reason`

- [ ] **Step 2: Implement schema changes**

Keep `agent_kind` required in `TaskSpecSchema`.

- [ ] **Step 3: Validate**

```bash
bun test packages/core/__tests__/schemas.test.ts
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
but commit agent-profiles-impl -m "feat: add role fields to task spec" --status-after
```

### Task 7: Store role columns

**Files:**
- Modify: `packages/store/src/task.ts`
- Modify: `packages/store/src/task-store.ts`
- Modify/Create migration file under `packages/store/src`
- Modify: `packages/store/__tests__/migrate.test.ts`
- Modify: `packages/store/__tests__/task-store.test.ts`

- [ ] **Step 1: Write migration/store tests**

Cover:
- migration creates nullable `role`, `role_source`, `role_selection_reason`
- `createTask` can persist role metadata
- existing rows without role still parse
- `listTasks` and `getTaskById` return role fields

- [ ] **Step 2: Implement migration and row schema**

Role columns are nullable.

- [ ] **Step 3: Update `CreateTaskInput`**

Accept role metadata from resolved submit flow.

- [ ] **Step 4: Validate**

```bash
bun test packages/store/__tests__/migrate.test.ts packages/store/__tests__/task-store.test.ts
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
but commit agent-profiles-impl -m "feat: persist task role metadata" --status-after
```

---

## Chunk 6: Prompt rendering and MCP profile listing

### Task 8: Inject role instructions into child prompt

**Files:**
- Modify: `packages/adapters/src/task-spec-prompt.ts`
- Modify: `packages/adapters/__tests__/task-spec-prompt.test.ts`

- [ ] **Step 1: Write prompt tests**

Cover:
- role profile and instructions appear when present
- no role keeps existing prompt behavior as close as possible
- child reporting contract remains after role instructions and task content

- [ ] **Step 2: Implement prompt rendering**

Render order:
1. role/profile section
2. task content/context/constraints/inputs/expected output
3. final non-overridable child reporting contract

- [ ] **Step 3: Validate**

```bash
bun test packages/adapters/__tests__/task-spec-prompt.test.ts
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
but commit agent-profiles-impl -m "feat: render role instructions in prompts" --status-after
```

### Task 9: `list_agent_profiles` operation

**Files:**
- Modify: `packages/mcp/package.json`
- Create: `packages/mcp/src/commands/list-agent-profiles.ts`
- Modify: `packages/mcp/src/operations.ts`
- Modify: `packages/mcp/__tests__/commands.test.ts`
- Modify: `packages/mcp/__tests__/cli.test.ts`
- Modify: `packages/mcp/__tests__/mcp-stdio-integ.test.ts`

- [ ] **Step 1: Write command tests**

Cover:
- builtin profiles listed
- `include_instructions` toggles body
- `cwd` loads project profiles
- `session_id` resolves via store to worktree path before discovery
- unknown session returns `session_not_found`
- malformed project profile returns structured `invalid_input`
- duplicate project profile ids return structured `invalid_input`
- reserved project profile `id: auto` returns structured `invalid_input`

- [ ] **Step 2: Implement command**

The command resolves `session_id -> cwd` in MCP using store. It passes only cwd/scope/include flags to `@cuekit/agent-profiles`.

- [ ] **Step 3: Register operation**

MCP name: `list_agent_profiles`.
CLI path: `agent list`.

- [ ] **Step 4: Validate**

```bash
bun test packages/mcp/__tests__/commands.test.ts packages/mcp/__tests__/cli.test.ts packages/mcp/__tests__/mcp-stdio-integ.test.ts
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
but commit agent-profiles-impl -m "feat: list agent profiles" --status-after
```

### Task 10: Explicit role resolution in `submit_task`

**Files:**
- Modify: `packages/mcp/src/commands/submit-task.ts`
- Modify: `packages/mcp/__tests__/commands.test.ts`
- Modify: `packages/mcp/__tests__/e2e.test.ts`

- [ ] **Step 1: Write submit tests**

Cover:
- explicit `role` supplies `agent_kind` and `model`
- `session_id` resolves to session worktree before profile discovery: create a session whose worktree contains `.cuekit/agents/*.md`, submit with `session_id` and role, and verify that worktree-local profile is used
- explicit MCP `agent_kind` overrides profile `agent_kind`
- explicit MCP `model` overrides profile `model`
- unknown role returns `invalid_input` with available role ids
- profile without `agent_kind` plus omitted submit `agent_kind` returns `invalid_input`
- invalid profile model fails through existing adapter validation
- malformed project profile returns structured `invalid_input`
- duplicate same-scope profile ids return structured `invalid_input`
- reserved `id: auto` returns structured `invalid_input`
- stored task has role columns and role fields in `spec_json`

- [ ] **Step 2: Refactor submit input schema**

Do not relax `TaskSpecSchema`. Use submit-specific unresolved schema that allows optional `agent_kind` when role may supply it.

- [ ] **Step 3: Implement explicit role resolution**

Resolve session/cwd first, discover profiles anchored to effective cwd, resolve role, then build strict `TaskSpec`.

- [ ] **Step 4: Validate**

```bash
bun test packages/mcp/__tests__/commands.test.ts packages/mcp/__tests__/e2e.test.ts
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
but commit agent-profiles-impl -m "feat: resolve submit task roles" --status-after
```

### Task 11: `role: "auto"` submit path

**Files:**
- Modify: `packages/mcp/src/commands/submit-task.ts`
- Modify: `packages/mcp/__tests__/commands.test.ts`

- [ ] **Step 1: Write auto selection tests**

Cover:
- review objective selects `reviewer`
- failing tests objective selects `debugger`
- docs objective selects `docs-writer`
- fallback selects `worker`
- `session_id` resolves to session worktree before auto profile discovery
- `role_selection_reason` appears in submit output and task row

- [ ] **Step 2: Implement auto path**

Use `@cuekit/agent-profiles` selector only when `role === "auto"`.

- [ ] **Step 3: Validate**

```bash
bun test packages/mcp/__tests__/commands.test.ts
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
but commit agent-profiles-impl -m "feat: auto-select agent profiles" --status-after
```

---

## Chunk 7: UI visibility

### Task 12: Status/TUI role display

**Files:**
- Modify: `packages/core/src/task-summary.ts`
- Modify: `packages/core/src/task-status-view.ts`
- Modify: `packages/mcp/src/commands/get-task-status.ts`
- Modify: `packages/mcp/src/commands/list-tasks.ts`
- Modify: `packages/tui/src/data.ts`
- Modify: `packages/tui/src/components/task-detail.tsx`
- Update related tests

- [ ] **Step 1: Write visibility tests**

Cover:
- `list_tasks` returns role metadata when present
- `get_task_status` returns role metadata when present
- TUI detail renders role/model/source context rows

- [ ] **Step 2: Implement status/list mapping**

Keep role fields optional to preserve old tasks.

- [ ] **Step 3: Implement TUI detail display**

Show role in the upper metadata/context area:

```text
role        reviewer (builtin)
model       sonnet
adapter     claude-code
```

- [ ] **Step 4: Validate**

```bash
bun test packages/mcp/__tests__/commands.test.ts packages/tui/__tests__/tui-data.test.ts packages/tui/__tests__/tui-smoke.test.ts
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
but commit agent-profiles-impl -m "feat: show task role metadata" --status-after
```

---

## Chunk 8: Final validation, dogfood, and docs

### Task 13: Documentation and examples

**Files:**
- Modify: `README.md` or relevant docs index
- Modify: `docs/README.md` if needed
- Create: `docs/issues/cuekit-agent-profiles-usage.md` if usage examples deserve separate doc

- [ ] **Step 1: Document usage**

Include examples:

```json
{ "role": "reviewer", "objective": "Review this diff" }
{ "role": "auto", "objective": "Investigate why tests are failing" }
{ "role": "reviewer", "agent_kind": "opencode", "objective": "Review this diff" }
```

- [ ] **Step 2: Document profile file format**

Include project/user paths and override behavior.

- [ ] **Step 3: Validate docs links**

Run `bun run check`.

- [ ] **Step 4: Commit**

```bash
but commit agent-profiles-impl -m "docs: document agent profiles" --status-after
```

### Task 14: Full validation and review

**Files:**
- No planned source changes unless validation finds issues.

- [ ] **Step 1: Full validation**

Run:

```bash
bun run typecheck
bun run check
bun run test
```

Expected:
- typecheck passes
- tests pass
- check has only known Biome schema-version info and broken `.claude/skills/*` symlink warnings

- [ ] **Step 2: Dogfood via MCP**

Submit small tasks:
- explicit `role: reviewer`
- `role: auto` with review/debug/docs objectives
- explicit `agent_kind` override with role

Wait with `wait_tasks`, inspect list/status/TUI, then delete with `delete_tasks`.

- [ ] **Step 3: Code review**

Run code-reviewer on the implementation with focus on:
- package boundaries
- strict TaskSpec resolution
- prompt contract ordering
- override security/parse errors
- migrations/backward compatibility

- [ ] **Step 4: Fix review issues**

Address Critical/Important findings and repeat review until no blocking issues remain.

- [ ] **Step 5: PR**

Create PR and merge after validation.
