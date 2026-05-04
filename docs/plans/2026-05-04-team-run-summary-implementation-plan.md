# Team Run Summary Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a concise team run summary to team status outputs so dogfood runs show what each position contributed and why the team was useful.

**Architecture:** Build a small summary helper in the MCP package from existing task rows and `task_events`, then include it in `get_status(kind: "team")` and `wait(kind: "team")` outputs. Keep the MCP tool surface unchanged and avoid new database schema.

**Tech Stack:** TypeScript, Bun tests, `incur` schemas, existing cuekit store APIs.

---

### Task 1: Add failing coverage for team run summary

**Files:**
- Modify: `packages/mcp/__tests__/commands.test.ts`

- [x] Add a `get-team-status` test that creates a team with coordinator/reviewer tasks, appends progress/completed events, then expects `run_summary.positions.coordinator` and `run_summary.positions.reviewer` to contain concise report entries.
- [x] Add a `wait-team` test or assertion showing `run_summary` is also present on `runWaitTeam` output.
- [x] Run focused tests and confirm they fail.

### Task 2: Implement run summary helper

**Files:**
- Create: `packages/mcp/src/team-run-summary.ts`

- [x] Define `TeamRunSummarySchema` with `completed_reports`, `latest_completed_message`, `positions`, and optional `open_attention`.
- [x] Implement `buildTeamRunSummary(ctx, tasks)` using `listTaskEvents` for each team task.
- [x] Group entries by `team_position`, truncate long event messages, and include task id/type/status/created_at.
- [x] Keep the helper pure/read-only and independent of CLI/MCP operation definitions.

### Task 3: Wire summary into outputs

**Files:**
- Modify: `packages/mcp/src/commands/get-team-status.ts`
- Modify: `packages/mcp/src/commands/wait-team.ts`

- [x] Add `run_summary: TeamRunSummarySchema` to success output schemas.
- [x] Include `run_summary: buildTeamRunSummary(ctx, tasks)` in `runGetTeamStatus`.
- [x] Include `run_summary` in `runWaitTeam`, using the snapshotted/latest team task set already used for aggregation.
- [x] Preserve existing output fields and error shapes.

### Task 4: Validate and review

- [x] Run focused command tests.
- [x] Run `bun test packages/mcp`.
- [x] Run `bun run typecheck`.
- [x] Run `bun run check`.
- [x] Request a cuekit team reviewer for the diff.
- [x] Commit with GitButler, open PR, merge, then cleanup team tasks.
