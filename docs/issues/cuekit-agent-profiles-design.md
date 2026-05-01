# Design: agent profiles and automatic role selection

## Background

cuekit can already submit tasks to runtime adapters (`claude-code`, `opencode`, `pi`) and monitor them through MCP/CLI/TUI. What is missing is a first-class way to say *what role* the child agent should play. Today every task is only an objective plus adapter/model options, so callers must manually embed reviewer/planner/debugger instructions into each objective.

`pi-subagents` shows a useful pattern: focused child agents are described by Markdown files with frontmatter metadata and body instructions. A parent can choose an agent profile such as `reviewer`, `planner`, or `scout`, launch a child with that role prompt, and optionally override builtin definitions at user/project scope.

## Decision

Add **Agent Profiles** to cuekit.

An agent profile is a Markdown file with:

- frontmatter: machine-readable routing/default metadata
- body: role instructions injected into the child task prompt

Example:

```md
---
id: reviewer
description: Strict review for correctness, tests, edge cases, and simplicity
agent_kind: claude-code
model: sonnet
tags:
  - review
  - code-quality
instructions_mode: replace
---

You are a strict code reviewer.

Focus on correctness, tests, regressions, and unnecessary complexity.
Report Critical and Important issues first. If there are no blocking issues,
say so plainly.
```

The public API uses `role` as the short user-facing field, while internal code uses `AgentProfile` as the implementation term.

```json
{
  "role": "reviewer",
  "objective": "Review the current diff"
}
```

`role: "auto"` asks cuekit to choose a profile from builtin/user/project profiles.

## Goals

- Let callers assign a child-agent role without hand-writing instructions each time.
- Let a profile provide `agent_kind` and `model`, using exactly those field names.
- Support project and user overrides from the first implementation.
- Preserve existing adapter/task/session storage and execution model.
- Keep role selection deterministic and debuggable for MVP.
- Expose discoverability through MCP/CLI (`list_agent_profiles`).
- Show the selected role/profile in task status/TUI.

## Non-goals

- Implement pi-subagents-style chains or parallel orchestration in this step.
- Add a new runtime adapter or replace existing adapters.
- Give child agents the ability to recursively spawn subagents.
- Add LLM-based profile selection in MVP.
- Support rich tool allowlists/skills enforcement in MVP. These can be metadata-only future fields.

## Profile file locations and precedence

Profiles are loaded from three scopes:

```text
1. project: .cuekit/agents/*.md
2. user:    ~/.cuekit/agents/*.md
3. builtin: packages/agent-profiles/src/builtins.ts embedded profile markdown strings
```

Precedence is:

```text
project > user > builtin
```

The same `id` in a higher scope overrides or extends the lower-scope profile.

## Profile schema

Recommended core type:

```ts
type InstructionsMode = "replace" | "append";
type AgentProfileSource = "builtin" | "user" | "project";

interface AgentProfileFile {
  id: string;
  description?: string;
  agent_kind?: string;
  model?: string;
  tags?: string[];
  instructions: string;
  instructions_mode?: InstructionsMode;
  source: AgentProfileSource;
  file_path?: string;
}

interface ResolvedAgentProfile {
  id: string;
  description: string;
  agent_kind?: string;
  model?: string;
  tags: string[];
  instructions: string;
  instructions_mode: InstructionsMode;
  source: AgentProfileSource; // highest contributing source
  sources: AgentProfileSource[];
  file_paths: string[];
}
```

`AgentProfileFile` is intentionally partial because user/project files can be overrides. `ResolvedAgentProfile` is the post-merge type used by submit/list and must satisfy required fields such as `description`.

Frontmatter fields:

| Field | Required in file | Required after merge | Purpose |
| --- | --- | --- | --- |
| `id` | yes | yes | Stable profile id used by `role` |
| `description` | builtin yes, override no | yes | Human/MCP discoverability and selector input |
| `agent_kind` | no | no | Runtime adapter to use when submit input omits `agent_kind` |
| `model` | no | no | Runtime model to use when submit input omits `model` |
| `tags` | no | no | Selection/search hints |
| `instructions_mode` | no | yes | `replace` by default, or `append` for additive overrides |

Future metadata can be accepted as `extra_fields` but ignored by MVP:

- `tools`
- `skills`
- `selection_hints`
- `priority`
- `disabled`

## Override semantics

When multiple profiles share the same `id`, merge from lowest to highest precedence:

```text
builtin -> user -> project
```

Duplicate ids inside the same scope are invalid. Discovery should sort files by path for stable error reporting, then reject duplicates with `invalid_input` that lists the conflicting paths. This avoids filesystem-order-dependent overrides.

`auto` is a reserved id. Profile files with `id: auto` are invalid because `role: "auto"` means selector mode.

### Frontmatter merge

Frontmatter uses shallow merge. Higher scope values replace lower scope values.

Example user override:

```md
---
id: reviewer
model: opus
instructions_mode: append
---

Also check for over-engineering and unclear abstractions.
```

The resolved profile keeps builtin `description`, `agent_kind`, and tags, changes `model` to `opus`, and appends the body to builtin instructions.

### Instructions merge

- `instructions_mode: replace` (default): higher body replaces lower instructions if body is non-empty.
- `instructions_mode: append`: higher body is appended to lower instructions with a clear separator.
- Empty body never clears lower instructions unless a future explicit `instructions_mode: clear` is introduced.

This gives users a simple model-only override without requiring them to copy the entire builtin prompt.

## Builtin profiles

Start with a small, practical set:

| id | intent | suggested agent_kind | suggested model |
| --- | --- | --- | --- |
| `worker` | General implementation | `claude-code` | `sonnet` |
| `reviewer` | Code/design review | `claude-code` | `sonnet` |
| `planner` | Implementation planning | `claude-code` | `sonnet` |
| `scout` | Fast codebase reconnaissance | `claude-code` | `haiku` |
| `debugger` | Systematic bug/test failure investigation | `claude-code` | `sonnet` |
| `docs-writer` | Documentation/changelog writing | `claude-code` | `haiku` |

The exact model names must remain compatible with each adapter's advertised `available_models`. Builtin profiles should therefore use current cuekit adapter model names (`haiku`, `sonnet`, `opus`) for `claude-code`.

## Project root and discovery anchor

Profile discovery must be anchored deterministically:

1. MCP resolves the effective task cwd before calling `@cuekit/agent-profiles`:
   - `submit_task.cwd` if provided
   - else existing session `worktree_path` when `session_id` is provided, resolved by `@cuekit/mcp` using `@cuekit/store`
   - else `process.cwd()` for CLI/server process context
2. MCP passes only the resolved absolute cwd (or project root) into `@cuekit/agent-profiles`.
3. `@cuekit/agent-profiles` canonicalizes that path and finds the project root by walking upward to the nearest `.git` directory/file. If none is found, it uses the effective cwd.
4. `@cuekit/agent-profiles` loads project profiles from `<project_root>/.cuekit/agents/*.md`.
5. `@cuekit/agent-profiles` loads user profiles from `~/.cuekit/agents/*.md`.

This mirrors existing session root behavior and prevents MCP callers from accidentally loading profiles from an unrelated server cwd when they pass an explicit task cwd. The package boundary is explicit: `@cuekit/agent-profiles` does not know about sessions or import `@cuekit/store`; session-to-cwd resolution remains in `@cuekit/mcp`.

## Submit-time resolution

Extend `submit_task` input with:

```ts
{
  role?: string; // profile id or reserved selector value "auto"
}
```

Resolution order:

### Profile

```text
input.role omitted -> no profile, current behavior
input.role == "auto" -> rule-based selector chooses profile
input.role == profile id -> resolve that profile or return invalid_input
```

### agent_kind

```text
input.agent_kind
-> selected_profile.agent_kind
-> invalid_input if still missing
```

Do **not** relax the shared `TaskSpecSchema`. Core and adapters should continue to require `TaskSpec.agent_kind`. Instead create a submit-specific schema that accepts unresolved inputs, then resolve into a strict `TaskSpec` before adapter submission/storage.

Recommended shape:

```ts
const SubmitTaskInputSchema = TaskSpecSchema.omit({ agent_kind: true, model: true }).extend({
  agent_kind: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
});
```

The stored `TaskSpec` must still contain the resolved `agent_kind`.

### model

```text
input.model
-> selected_profile.model
-> undefined
```

Existing adapter capability validation remains authoritative. If a profile's model is invalid for the resolved adapter, `submit_task` returns the same structured `invalid_input` error that direct model selection uses today.

### prompt injection

The selected profile instructions are added to the child prompt via `renderTaskSpecPrompt(spec)`.

Profile instructions are user/project-controlled and must not be allowed to override cuekit's operational child contract. `renderTaskSpecPrompt` should render in this order:

1. cuekit task/objective and role instructions
2. existing context/constraints/inputs/expected output
3. **final non-overridable child reporting contract**

The reporting contract remains the last section so profile text cannot accidentally supersede it.

Recommended `TaskSpec` additions:

```ts
interface TaskSpec {
  agent_kind: string;
  objective: string;
  model?: string;
  role?: string;
  role_instructions?: string;
  role_source?: "builtin" | "user" | "project";
  role_sources?: Array<"builtin" | "user" | "project">;
  role_selection_reason?: string;
  // existing fields...
}
```

Alternative: store resolved profile data outside `TaskSpec`. The MVP should prefer adding explicit optional fields to `TaskSpec` so task rows are auditable and adapters can render a single canonical prompt.

Prompt shape:

```md
# Role

Profile: reviewer

## Instructions

<resolved profile instructions>

# Task

<objective and existing TaskSpec details>
```

## Automatic selection

MVP uses deterministic rules rather than an LLM.

Selector input:

- objective
- optional context/constraints
- available profiles' id/description/tags

Suggested rule examples:

| Objective keywords | Profile |
| --- | --- |
| `review`, `diff`, `PR`, `pull request` | `reviewer` |
| `plan`, `design`, `spec`, `break down` | `planner` |
| `bug`, `debug`, `failing`, `failure`, `test failure` | `debugger` |
| `docs`, `README`, `changelog` | `docs-writer` |
| `inspect`, `explore`, `understand`, `map` | `scout` |
| fallback | `worker` |

`submit_task` output should include selection metadata when a role was used:

```ts
{
  accepted: true,
  task_id: "t_...",
  agent_kind: "claude-code",
  session_id: "s_...",
  role: "reviewer",
  role_source: "builtin",
  role_sources: ["builtin"],
  role_selection_reason?: "matched keyword: review"
}
```

## MCP/CLI API

### `submit_task`

Add:

```ts
role?: string // profile id or "auto"
```

The existing `agent_kind` remains valid and overrides profile `agent_kind`.

### `list_agent_profiles`

Input:

```ts
{
  scope?: "all" | "builtin" | "user" | "project";
  cwd?: string;
  session_id?: string;
  include_instructions?: boolean; // default false
}
```

For `scope: "project"` or `scope: "all"`, MCP resolves `cwd`/`session_id` exactly like `submit_task` before calling `@cuekit/agent-profiles`. If neither is provided, CLI/MCP may fall back to `process.cwd()`, but that fallback should be explicit in output/debug logs so callers understand which project profile directory was inspected. `scope: "builtin"` and `scope: "user"` do not need project cwd resolution.

Output:

```ts
{
  profiles: Array<{
    id: string;
    description: string;
    agent_kind?: string;
    model?: string;
    tags: string[];
    source: "builtin" | "user" | "project"; // highest contributing source
    sources: Array<"builtin" | "user" | "project">;
    file_paths: string[];
    instructions?: string;
  }>;
}
```

CLI path:

```text
cuekit agent list
```

Future paths:

```text
cuekit agent show --id reviewer
cuekit agent init --id reviewer --scope project
```

## Storage and status visibility

To make TUI/status useful, persist resolved role metadata. Options:

### Option A: store in `spec_json` only

Pros:
- no migration
- fast MVP

Cons:
- list/status requires parsing spec JSON to show role
- harder to filter by role later

### Option B: add task columns

```sql
alter table tasks add column role text;
alter table tasks add column role_source text;
```

Pros:
- easy TUI/list display
- future filtering by role
- clear audit field

Cons:
- migration required

Recommendation: **Option B**. Role is important task metadata, similar to `agent_kind` and `model`.

Persist at least:

```sql
alter table tasks add column role text;
alter table tasks add column role_source text;
alter table tasks add column role_selection_reason text;
```

`role_sources` and full resolved instructions can remain in `spec_json` for audit/debugging without adding more columns.

## TUI changes

- Task list can optionally include role if width permits, or keep list compact and show role in detail title/context.
- Detail context should show:

```text
role        reviewer (builtin)
model       sonnet
adapter     claude-code
```

- If no role was used, omit the role row.

## Package placement

Create a dedicated workspace package from the start:

```text
packages/agent-profiles/
  package.json              # @cuekit/agent-profiles
  tsconfig.json
  src/
    index.ts
    schema.ts               # profile file/resolved schemas and public types
    frontmatter.ts          # parse markdown frontmatter/body
    discovery.ts            # load builtin/user/project profiles
    merge.ts                # override merge and duplicate validation
    selection.ts            # deterministic auto selector
    project-root.ts         # cwd/project-root profile anchor helper; no session/store dependency
    builtins.ts             # embedded builtin profile markdown strings

packages/core/src/task-spec.ts
  role metadata fields only

packages/store/src/*
  task role columns migration and row mapping

packages/mcp/src/commands/list-agent-profiles.ts
packages/mcp/src/commands/submit-task.ts
packages/mcp/src/operations.ts
packages/adapters/src/task-spec-prompt.ts
packages/tui/src/data.ts / task-detail.tsx
```

Dependency direction:

```text
@cuekit/agent-profiles -> @cuekit/core
@cuekit/mcp            -> @cuekit/agent-profiles
@cuekit/mcp            -> @cuekit/core / @cuekit/store / @cuekit/adapters
@cuekit/tui            -> @cuekit/core
@cuekit/adapters       -> @cuekit/core
```

`@cuekit/tui` does not import `@cuekit/agent-profiles`; it only displays role metadata persisted on tasks/status views. This keeps profile discovery out of human UI code and avoids frontend/package cycles.

`@cuekit/agent-profiles` owns discovery, parsing, merge, builtin profiles, and selection because those concerns are reusable beyond MCP: future TUI profile managers, profile init/show commands, or orchestration features can depend on the package without pulling in MCP server code.

`@cuekit/core` should not own profile discovery. It only needs the `TaskSpec` role fields because adapter prompt rendering consumes those fields.

Builtin profiles should be embedded in TypeScript (`builtins.ts`) for MVP rather than loaded from `src/**/*.md` at runtime. This avoids build/publish asset-copy issues. A later packaging pass can move them to external Markdown assets if the package build explicitly includes them.

## Safety and validation

- Unknown `role` returns `invalid_input` with available role ids.
- Profile id `auto` is rejected during discovery because it is reserved for selector mode.
- Duplicate ids in the same scope are rejected with conflicting file paths.
- `role: "auto"` records selected role and reason.
- A profile without `agent_kind` requires `submit_task.agent_kind`.
- A profile without `model` simply leaves `model` unset unless submit input provides one.
- Adapter model validation remains unchanged and catches invalid profile model choices.
- Project profile parse errors should return structured `invalid_input` for submit/list, not crash the server.
- User/profile directories missing is not an error.

## Testing plan

- frontmatter parser:
  - metadata + body
  - tags as YAML list and comma string if supported
  - missing frontmatter
- discovery:
  - builtin only
  - user overrides builtin
  - project overrides user and builtin
  - `instructions_mode: replace`
  - `instructions_mode: append`
  - duplicate ids in same scope fail deterministically
  - reserved `id: auto` fails
  - explicit `cwd`, relative `cwd`, omitted `cwd`, and nested project roots anchor project profile lookup correctly
- MCP command integration:
  - `submit_task.session_id` resolves to session `worktree_path` before profile discovery
  - `list_agent_profiles.session_id` resolves to session `worktree_path` before profile discovery
- submit:
  - explicit role resolves `agent_kind` and `model`
  - explicit `agent_kind` / `model` override profile fields
  - unknown role returns `invalid_input`
  - `role: auto` selects expected builtin profile
  - invalid profile model fails via existing adapter validation
- prompt rendering:
  - role instructions appear before task objective
  - no role keeps current prompt shape as much as possible
- TUI/status:
  - role/model rows display when present
- cleanup:
  - profile tests do not create task artifact directories unless explicitly testing adapter submit

## Open questions

1. Should the public field be only `role`, or also accept `agent_profile` as an alias?
2. Should profile body replace or append by default for project/user overrides? This design recommends replace by default with explicit append.
3. Should `list_agent_profiles` include disabled/future profiles or hide them?
4. Should auto selection be exposed as a dry-run command such as `select_agent_profile` for debugging?
5. Should task list filtering eventually support `role` once role columns exist?

## Recommended first implementation slice

1. Add `@cuekit/agent-profiles` package with schema/types, frontmatter parsing, embedded builtin markdown strings, discovery, merge, and validation.
2. Add deterministic project/user/builtin discovery with override merge.
3. Add `list_agent_profiles` MCP/CLI operation backed by `@cuekit/agent-profiles`.
4. Extend `submit_task` with explicit `role` only and resolve to a strict `TaskSpec`.
5. Inject role instructions into prompt and persist role columns.
6. Add TUI detail role/model display.
7. Add `role: "auto"` deterministic selector after explicit-role path is stable.
