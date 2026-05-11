---
name: cuekit-strategy-authoring
description: Use when designing, reviewing, generating, or updating .cuekit.yaml Team Strategies for a project. Inspects project docs/code to propose focused cuekit strategies, recommended teams, guardrails, success criteria, checks, and autonomy settings without turning strategies into rigid workflows.
---

# cuekit Strategy Authoring

Use this skill when asked to create, review, improve, or maintain `.cuekit.yaml` `strategies:` for a project.

This skill is for **strategy design**, not normal implementation. A cuekit Team Strategy is a mission playbook that guides a coordinator; it is not a workflow engine, scheduler, or rigid task graph.

## Goals

- Inspect the project and infer useful recurring work modes.
- Define strategies that help agents choose coordinator/worker/reviewer roles consistently.
- Keep strategy definitions small, explicit, and project-specific.
- Preserve cuekit's architecture: strategies guide coordinator reasoning; they do not replace it.
- Avoid overfitting strategies to one-off tasks.

## Required Project Recon

Before editing `.cuekit.yaml`, inspect the project context:

1. `AGENTS.md` and any parent/global guidance visible to the agent.
2. `README.md` for user-facing purpose and commands.
3. Existing `.cuekit.yaml` if present.
4. Architecture/design docs, commonly:
   - `docs/architecture/README.md`
   - `docs/architecture/*.md`
   - `docs/decisions/*.md`
   - `docs/guides/*.md`
   - `docs/issues/*.md` when active design notes live there.
5. Package/module layout and test commands:
   - package manifests such as `package.json`, `pyproject.toml`, `Cargo.toml`, etc.
   - existing CI/check commands.
6. Existing agent profiles if relevant:
   - `.cuekit/agents/*.md`
   - `.agents/skills/*`
   - built-in/common roles mentioned in docs.

Do not design strategies from names alone. Use project evidence.

## Strategy Discovery and Review

If cuekit is available, inspect current strategies first.

Preferred MCP:

```json
{
  "kind": "strategies",
  "cwd": "/path/to/project"
}
```

Use `cuekit_list` with `kind: "strategies"`.

CLI fallback:

```bash
cuekit strategy list --cwd . --format json
cuekit strategy show --strategy feature --cwd . --format json
```

If both fail, read `.cuekit.yaml` directly.

## What to Propose

For each proposed strategy, define only fields that have concrete value:

```yaml
strategies:
  example:
    description: "Short human-readable purpose"
    intent: "What the coordinator should optimize for."
    recommended_team:
      coordinator:
        position: coordinator
        role: planner
        agent: pi
      worker:
        position: worker
        role: worker
        agent: claude-code
      reviewer:
        position: reviewer
        role: reviewer
        agent: claude-code
    guardrails:
      - "Concrete constraints and things not to do."
    success_criteria:
      - "Observable acceptance criteria."
    checks:
      - "command to run"
    autonomy:
      allow_additional_workers: true
      allow_parallel_reviewers: false
      require_reviewer: true
      allow_skip_checks: false
```

### Field Guidance

- `description`: one line, task-selection oriented.
- `intent`: mission brief for coordinator; should explain the strategy's optimization target.
- `recommended_team`: recommendations only. Explicit caller input must still win.
- `guardrails`: project constraints, architecture boundaries, safety rules, and scope limits.
- `success_criteria`: evidence that the strategy succeeded.
- `checks`: realistic commands the project already supports.
- `autonomy`: how much freedom the coordinator has.

## Recommended Strategy Categories

Derive categories from the project. Common useful categories include:

| Category | Use when |
|---|---|
| `feature` | Small-to-medium behavior or API additions |
| `bugfix` | Root-cause fixes with regression coverage |
| `refactor` | Behavior-preserving maintainability improvements |
| `architecture-review` | Reviewing code against architecture/design docs |
| `docs-polish` | README/guides/changelog/doc-only changes |
| `dogfood` | Validating cuekit itself, tools, adapters, TUI, or workflows |
| `mcp-surface` | MCP/CLI operation surface, schemas, and AI-facing tool UX |
| `adapter-work` | Runtime adapter behavior, process handling, reporting, tmux/pane integration |
| `store-migration` | Persistence/schema/migration changes |
| `tui-work` | TUI/OpenTUI changes and interaction testing |
| `release` | changelog/version/release preparation |
| `parent-session` | long-lived parent workspaces for shared development coordination |

Do not add all categories by default. Add only strategies supported by real project needs.

> **Parent-session note**: a parent session is a long-lived task submitted with `role: parent`, `metadata.run_kind: "parent_session"`, and `metadata.long_lived: true` (and `timeout_ms: null`). It does not require a separate strategy — use `cuekit task submit` or `cuekit_submit_task` directly. Only add a `parent-session` strategy when the project wants to standardize coordinator/worker patterns for parent workspace workflows.

## Design Rules

### Keep Strategies as Playbooks, Not Workflows

Good:

```yaml
intent: "Coordinate a small MCP surface change with tests and architecture review."
```

Bad:

```yaml
steps:
  - create branch
  - edit file A
  - run test B
  - submit reviewer C
```

The coordinator decides how to decompose work. Strategy should provide mission, roles, checks, and guardrails.

### Avoid Overlapping Strategies

Before adding a strategy, compare it to existing ones:

- If it differs only by one check, update the existing strategy.
- If it targets a distinct subsystem or risk profile, a new strategy may be useful.
- If a strategy has not been used and is vague, prefer deleting or simplifying it.

### Prefer Concrete Guardrails

Good guardrails mention project-specific risks:

- "Do not make `@cuekit/core` depend on SQLite, MCP SDK, process spawning, or filesystem side effects."
- "Keep MCP surface grouped; avoid adding flat tools unless ADR changes."
- "For adapter changes, preserve child reporting and timeout semantics."

Bad guardrails are generic:

- "Write good code."
- "Be careful."

### Checks Must Exist

Only list checks that can realistically run in the project. Prefer existing commands from docs/package manifests.

Examples for cuekit:

```yaml
checks:
  - "bun test"
  - "bun run typecheck"
  - "bun run check"
```

For docs-only strategies, narrower checks may be better:

```yaml
checks:
  - "git diff --check"
  - "bun run check"
```

## Safe Editing Process

1. Read context and current strategies.
2. Summarize observed project work modes.
3. Propose strategy additions/changes before editing when the change is broad.
4. Edit `.cuekit.yaml` with minimal, focused changes.
5. Validate YAML/config parsing if project provides a command or test.
6. If strategy behavior affects docs, update relevant docs.
7. Report what changed and why.

## Validation Suggestions

Use available project checks. For cuekit itself, prefer:

```bash
bun run check
bun run typecheck
bun test packages/project-config/__tests__/schema.test.ts -t strategies
bun test packages/mcp/__tests__/commands.test.ts -t strategy
```

If only editing `.cuekit.yaml`, still run at least config/schema-focused checks when practical.

## Output Format

When proposing strategies, use this concise structure:

```md
## Observed project work modes
- ...

## Recommended strategy changes
1. `strategy-name` — add/update/remove
   - Why: ...
   - Key roles: ...
   - Guardrails: ...
   - Checks: ...

## Risks / non-goals
- ...

## Validation
- ...
```

When editing, include file paths and validation commands in the final response.

## Anti-Patterns

Do not:

- Add a strategy for every package automatically.
- Encode a rigid workflow graph in strategy config.
- Use strategies to bypass permissions or explicit user choices.
- Add checks that do not exist.
- Duplicate `feature`, `bugfix`, or `refactor` with only cosmetic differences.
- Let strategy-derived role/agent/model override explicit request fields.
- Hide uncertainty; mark speculative strategies as proposals.
