# Design: PR finisher agent profile

## Status

Draft design note for a focused builtin profile and first-class finisher strategy slot convention.

## Problem

cuekit strategy/team workflows can already delegate planning, implementation, and review. In practice, the final release step is repetitive and easy to miss:

- verify validation has passed,
- inspect the final workspace state,
- commit with the project-approved VCS flow,
- push and create a GitHub PR,
- merge only when safe,
- update the local workspace after merge, and
- clean up terminal cuekit tasks when appropriate.

Today the parent agent usually performs this manually. That creates repeated boilerplate and increases the chance that a PR is opened without validation evidence, merged with unexpected changes, or left with stale local branches/tasks.

## Design Goal

Add a **`pr-finisher` builtin Agent Profile** and recommend a **`finisher` strategy slot** using `position: finisher` for strategies that commonly end in PR creation, merge, cleanup, or report-back.

The profile should act as a release/PR completion checklist runner, not as an implementation worker. It should be used after implementation and review are complete, when the user or coordinator expects the work to be committed, pushed, PR'd, and possibly merged.

## Non-Goals

- Do not make cuekit automatically create or merge PRs.
- Do not require GitButler for users who do not have it installed.
- Do not bypass project/user VCS instructions.
- Do not merge PRs when validation failed, CI is failing, the branch is dirty, or required credentials/tools are missing.

## Builtin Profile

Add builtin profile id `pr-finisher`.

Suggested metadata:

```md
---
id: pr-finisher
description: Finish validated work by committing, opening/merging PRs, syncing the workspace, and cleaning up safely
agent_kind: claude-code
model: sonnet
tags:
  - release
  - pr
  - git
  - cleanup
---
```

Core operating guidance:

1. Confirm scope and prerequisites.
   - Inspect project/user instructions for VCS rules.
   - Confirm requested behavior: create PR only, merge PR, or stop before merge.
   - Confirm validation commands and reviewer status are present; run or request missing validation when appropriate.
2. Select VCS flow safely.
   - If project/user instructions require GitButler/`but`, use `but`.
   - If GitButler is required but unavailable, stop and report instead of silently falling back.
   - If GitButler is not required, prefer `but` when available; otherwise use normal `git` commands.
   - Always summarize which VCS flow was used.
3. Protect the branch.
   - Inspect status before staging/committing.
   - Do not include unrelated or unexpected changes.
   - Do not merge if validation failed, status checks fail, merge state is not clean, or the PR contains unexplained changes.
4. Use GitHub CLI when available for PR operations.
   - `gh pr create` for PR creation.
   - `gh pr view --json mergeStateStatus,statusCheckRollup,...` before merge.
   - `gh pr merge` only when safe and requested.
   - If `gh` is missing or unauthenticated, stop and report manual next steps.
5. Clean up conservatively.
   - After merge, sync the local workspace using the selected VCS flow.
   - Use cuekit cleanup hints when present.
   - Dry-run or inspect cleanup targets first; clean only terminal tasks unless explicitly asked otherwise.
6. Report evidence.
   - PR URL, merge commit if merged, validation commands/results, VCS flow, cleanup performed or skipped, and any remaining manual action.

## VCS Fallback Policy

The builtin must be portable across projects:

| Condition | Behavior |
| --- | --- |
| Project/user instructions require `but` and `but` exists | Use `but` for VCS write operations. |
| Project/user instructions require `but` but `but` is unavailable | Stop and report. Do not silently use `git`. |
| No explicit GitButler requirement and `but` exists | Prefer `but`, especially when already in GitButler workspace mode. |
| No explicit GitButler requirement and `but` is unavailable | Use standard `git` flow. |
| `gh` unavailable or unauthenticated | Stop before PR operations and report manual steps. |

This preserves cuekit's global usefulness while respecting repository-specific rules. In this cuekit repository, project instructions require GitButler, so `pr-finisher` should use `but` and stop if it cannot.

## Strategy Slot Convention

Add an optional `finisher` slot to strategies where PR completion is a common final phase:

```yaml
finisher:
  position: finisher
  role: pr-finisher
  agent: claude-code
  model: sonnet
  objective: "After implementation, validation, and review are complete, finish the PR flow requested by the parent."
```

Use `position: finisher` rather than overloading `position: reviewer`. The position marks a first-class finalization lane for team status, prompt context, and run-summary grouping; the `role: pr-finisher` Agent Profile supplies PR-specific instructions.

Recommended initial strategies:

- `feature`
- `bugfix`
- `refactor`
- `docs-polish`
- `dogfood`

`architecture-review` should usually not include a finisher slot because it is often read-only and follow-up oriented.

The strategy slot is a recommendation. The coordinator should submit the finisher only when the parent/user wants PR creation or merge, not for every strategy run.

## Skill Integration

Update `cuekit-dogfood` guidance:

- For cuekit repo work where the user expects PR creation/merge, ask the strategy coordinator to use the `finisher` slot or submit a `position: finisher`, `role: pr-finisher` task after implementation and review are complete.
- The parent should still verify final evidence and `cuekit_get_team_result` before final reporting.
- The finisher should not cleanup or delete tasks/teams beyond terminal cleanup targets unless requested.

## Tests and Validation

Implementation should update:

- builtin profile catalog tests to include `pr-finisher`,
- builtin instruction quality tests,
- optional auto-selection tests if `selectAgentProfile` gains PR-finish-specific keywords,
- team/core schema and run-summary tests to include `position: finisher`,
- project config/schema tests if `.cuekit.yaml` strategy slots are expanded,
- docs index links.

Validation commands:

```sh
bun test packages/agent-profiles/__tests__/builtins.test.ts packages/agent-profiles/__tests__/selection.test.ts packages/project-config/__tests__/schema.test.ts
bun run typecheck
bun run check
```

Run broader `bun test` before PR merge.
