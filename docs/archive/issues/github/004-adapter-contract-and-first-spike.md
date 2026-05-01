## Summary
Define the adapter contract in `packages/adapters` and build one real end-to-end adapter spike, while keeping the other target runtimes stubbed but truthfully described.

## Why
cuekit only becomes useful when a runtime can actually be wrapped behind the shared protocol. The first adapter should prove the abstraction before more time is spent broadening support.

## Scope
Implement:
- adapter interface
- adapter registry
- result normalizer
- one working adapter spike
- stubs for the other target runtimes

## Deliverables
### Source files
- `packages/adapters/src/index.ts`
- `packages/adapters/src/agent-adapter.ts`
- `packages/adapters/src/adapter-registry.ts`
- `packages/adapters/src/result-normalizer.ts`
- `packages/adapters/src/pi-adapter.ts`
- `packages/adapters/src/claude-code-adapter.ts`
- `packages/adapters/src/opencode-adapter.ts`

### Tests
- `packages/adapters/__tests__/adapter-registry.test.ts`
- `packages/adapters/__tests__/<first-adapter>.test.ts`

## Detailed tasks
- [ ] Create `@cuekit/adapters` package manifest and tsconfig
- [ ] Add dependencies on `@cuekit/core` and `@cuekit/store`
- [ ] Define `AgentAdapter` contract
  - [ ] `submit`
  - [ ] `status`
  - [ ] `collect`
  - [ ] `cancel`
  - [ ] `list`
  - [ ] optional/best-effort steering support
- [ ] Implement adapter registry
  - [ ] register by `agent_kind`
  - [ ] reject duplicates
  - [ ] list capabilities
- [ ] Implement result normalizer
  - [ ] normalize native output into cuekit result shape
  - [ ] validate normalized output with Zod
- [ ] Choose the easiest runtime for the first real spike
- [ ] Implement the first adapter so it can:
  - [ ] submit work
  - [ ] observe status
  - [ ] collect normalized result
  - [ ] cancel in-flight work
- [ ] Stub the remaining adapters
  - [ ] expose honest capabilities
  - [ ] return structured unsupported/unimplemented errors where needed
- [ ] Add adapter registry tests
- [ ] Add first-adapter contract tests
- [ ] Run validation commands
  - [ ] `bun run --filter '@cuekit/adapters' test`
  - [ ] `bun run --filter '@cuekit/adapters' typecheck`

## Acceptance criteria
- Registry works and prevents duplicate registration
- At least one adapter demonstrates the full minimal lifecycle
- Stubs exist for the other adapters without pretending unsupported features work
- Runtime-native output is normalized and schema-validated
- The adapter package remains independent from `incur`

## Out of scope
- Perfect support for all three runtimes
- Rich event streaming
- Advanced steering semantics
- Orchestration/planning logic

## References
- `docs/specs/2026-04-23-cuekit-adapter-spec.md`
- `docs/specs/2026-04-23-cuekit-design.md`
- `docs/architecture/overview.md`
