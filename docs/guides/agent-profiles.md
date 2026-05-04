# Agent Profiles

Agent profiles let callers describe the child agent's role with `role` instead of repeating role instructions in every objective. Profiles are Markdown files with frontmatter metadata and body instructions.

## Where profiles live

cuekit discovers profiles in three scopes and merges them by precedence:

1. **builtin** — packaged profiles (`worker`, `reviewer`, `planner`, `scout`, `debugger`, `docs-writer`)
2. **user** — `~/.cuekit/agents/*.md`
3. **project** — `<project-root>/.cuekit/agents/*.md`

Project profiles override user profiles, and user profiles override builtins. The project root is the nearest directory containing `.git`.

## Profile format

```md
---
id: reviewer
description: Review code for correctness, tests, regressions, and simplicity
agent_kind: claude-code
model: sonnet
tags:
  - review
  - quality
instructions_mode: append
---

Apply the team's local review checklist. Focus on correctness, tests, and edge cases.
```

Fields:

- `id` — profile id used by `submit_task.role`; `auto` is reserved and invalid as a profile id.
- `description` — human-readable summary; required after builtin/user/project merge.
- `agent_kind` — default runtime adapter, e.g. `claude-code`, `opencode`, `jcode`, or `pi`.
- `model` — default model for adapters that support model selection.
- `tags` — optional list or comma-separated tags.
- `instructions_mode` — `replace` (default) or `append` when overriding a lower-scope profile.
- body — instructions injected into the child prompt before cuekit's final reporting contract.

Frontmatter is shallow-merged. A non-empty body replaces lower-scope instructions by default; set `instructions_mode: append` to append a non-empty local body to the lower-scope body. An empty override body inherits lower-scope instructions.

## Schema Reference

### AgentProfileFile vs ResolvedAgentProfile

cuekit operates with two profile schemas:

**AgentProfileFile** — the raw structure parsed from a single Markdown file:
- Contains metadata from frontmatter plus body instructions
- `description` is optional; `instructions` defaults to an empty string when the body is empty
- Used internally before builtin/user/project override merge

**ResolvedAgentProfile** — the final merged structure after scope resolution:
- Synthesized from multiple AgentProfileFile entries (builtin + user + project)
- `description` and `instructions` are required and non-empty after merge
- Includes `sources` (array of scope origins) and `file_paths` (array of file locations)
- Used in task submission, role selection, and listings with resolved values
- Represents the effective profile that will run

### Field Reference

| Field | Type | In File | In Resolved | Default | Notes |
|-------|------|---------|-------------|---------|-------|
| `id` | string | required | required | — | Profile identifier; must not be `"auto"` (reserved). Immutable across scopes. |
| `description` | string | optional | required | — | Human-readable summary. Required after merge; if missing from all scopes, merge fails. |
| `agent_kind` | string | optional | optional | — | Runtime adapter, e.g., `claude-code`, `opencode`, `jcode`, `pi`. If omitted, resolved value comes from lower scope. |
| `model` | string | optional | optional | — | Default model for adapters supporting model selection. If omitted, resolved value comes from lower scope. |
| `tags` | string[] | optional | present | `[]` after resolution | Searchable labels. Shallow-merged from file; project tags do not extend user tags. |
| `instructions` | string | defaults to `""` | required | `""` → required | Body text becomes instructions. A non-empty body replaces lower-scope instructions by default; set `instructions_mode: append` to extend lower-scope instructions. Required to be non-empty after merge. |
| `instructions_mode` | `"replace"` \| `"append"` | optional | present | `"replace"` | Controls how non-empty body instructions are merged with lower scopes. `"replace"` (default) replaces lower body; `"append"` concatenates using a `---` separator. Empty override bodies inherit lower instructions. Frontmatter fields always shallow-merge. |
| `source` | `"builtin"` \| `"user"` \| `"project"` | injected by discovery | required | — | Scope of origin. Users do not write this in frontmatter; cuekit supplies it from the discovery location. In ResolvedAgentProfile, `sources` captures all scope origins in merge order. |
| `file_path` | string | optional | — | — | Filesystem path to the profile file; populated by cuekit, not user-written. |
| `file_paths` | string[] | — | default | `[]` | Array of file paths for all profiles in the merge chain; only in ResolvedAgentProfile. |
| `extra_fields` | object | optional internal field | — | — | Reserved internal extension slot. Unknown frontmatter keys are not part of the public profile contract. |

### Reserved ID

The string `"auto"` is reserved as a special value for automatic role selection (see [Automatic role selection](#automatic-role-selection)). Profile `id` values must not be `"auto"`; validation rejects this.

### Body-to-Instructions Mapping

The Markdown body (after frontmatter) becomes the `instructions` field:

```md
---
id: reviewer
description: Review code
---

Instructions start here. This entire block becomes
the instructions field, preserving formatting.
```

Results in: `instructions: "Instructions start here. This entire block becomes\nthe instructions field, preserving formatting."`

### Scope Merge and Override Rules

1. **Scope precedence**: project > user > builtin
2. **Frontmatter merge**: Shallow merge (project values override user/builtin, user overrides builtin)
3. **Body/instructions merge**:
   - Empty override body: inherit the lower-scope instructions regardless of `instructions_mode`
   - Non-empty body + `instructions_mode: "replace"` (default): replace lower-scope instructions
   - Non-empty body + `instructions_mode: "append"`: append to lower-scope instructions with a `---` separator
4. **Required fields after merge**:
   - `description` must be non-empty (merge fails if all scopes omit it)
   - `instructions` must be non-empty (merge fails if all scopes have empty bodies)
5. **Sources and file_paths**: ResolvedAgentProfile includes arrays capturing all scope origins and file paths in merge order, useful for debugging and attribution

### Validation Rules

- `id`: Non-empty string; cannot be `"auto"`
- `description`: Non-empty string (required after merge, optional in file)
- `agent_kind`, `model`: Non-empty strings (optional)
- `tags`: Array of non-empty strings (optional)
- `instructions`: Non-empty string (required after merge, defaults to `""` in file)
- `instructions_mode`: Must be `"replace"` or `"append"`
- `source`: Must be `"builtin"`, `"user"`, or `"project"`; injected by discovery, not user-authored frontmatter

A single override file may omit `description` or body instructions; merge validation ensures the final ResolvedAgentProfile is complete and usable.

## Listing profiles

```sh
cuekit agent list
cuekit agent list --scope project --cwd /path/to/repo --include_instructions true
```

MCP tool: `list_agent_profiles`.

## Submitting with an explicit role

```json
{
  "objective": "Review the diff for regressions",
  "role": "reviewer",
  "cwd": "/path/to/repo"
}
```

If `agent_kind` is omitted, cuekit uses the profile's `agent_kind`. If `model` is omitted, cuekit uses the profile's `model` when present.

Explicit submit fields win over profile defaults:

```json
{
  "objective": "Review with the local reviewer profile but run in pi",
  "role": "reviewer",
  "agent_kind": "pi",
  "model": "k2p5",
  "cwd": "/path/to/repo"
}
```

## Automatic role selection

Use `role: "auto"` to let cuekit choose a role deterministically from the objective/context:

```json
{
  "objective": "Debug the failing auth tests",
  "role": "auto",
  "cwd": "/path/to/repo"
}
```

MVP selection is rule-based and explainable:

- review/diff/PR → `reviewer`
- plan/design/spec → `planner`
- bug/debug/failing/test failure → `debugger`
- docs/README/changelog → `docs-writer`
- inspect/explore/understand/map → `scout`
- fallback → `worker`

The selected `role` and `role_selection_reason` are stored on the task and returned by status/list APIs. The TUI detail pane shows role/source/model when present.
