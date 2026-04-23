## Summary
Validate the minimal cuekit v0 flow end-to-end and update the docs so the implemented behavior is understandable and reproducible.

## Why
Before expanding scope, we need proof that at least one adapter can complete the full submission lifecycle and that the CLI/MCP surfaces behave consistently.

## Scope
- smoke test the full flow
- verify local result/transcript refs
- confirm CLI/MCP parity
- update README and doc indexes

## Deliverables
- end-to-end smoke coverage
- updated root README
- updated doc indexes/references as needed

## Detailed tasks
- [ ] Add a smoke test for the minimal flow
  - [ ] `submit_task`
  - [ ] `get_task_status`
  - [ ] `get_task_result`
- [ ] Add/verify cancel-path coverage if the first adapter supports it
- [ ] Verify local refs are created consistently
  - [ ] `<worktree>/.cuekit/tasks/<task-id>.result.json`
  - [ ] `<worktree>/.cuekit/tasks/<task-id>.transcript.md`
- [ ] Validate the same flow through the CLI surface
- [ ] Validate that CLI and MCP payload semantics do not drift
- [ ] Update root `README.md`
  - [ ] describe package roles
  - [ ] explain how to run CLI
  - [ ] explain how to run MCP
  - [ ] explain where state is stored
  - [ ] document current v0 scope and non-goals
- [ ] Update docs indexes and links if implementation paths changed
- [ ] Run full workspace checks
  - [ ] `bun run typecheck`
  - [ ] `bun run test`
  - [ ] `bun run check`

## Acceptance criteria
- At least one adapter completes the minimal end-to-end flow
- Result and transcript refs are emitted in a documented and consistent location
- README matches actual behavior
- Spec/architecture links still resolve
- CLI and MCP surfaces remain semantically aligned

## Out of scope
- New protocol features
- New adapters beyond what is necessary to validate v0
- Planner/orchestrator features

## References
- `README.md`
- `docs/specs/README.md`
- `docs/architecture/README.md`
- `docs/plans/2026-04-23-cuekit-implementation-plan.md`
