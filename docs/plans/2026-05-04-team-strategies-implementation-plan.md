# Team Strategies Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-local Team Strategies that render mission briefs for coordinator-led Task Teams without turning cuekit into a rigid workflow engine.

**Architecture:** Team Strategies are `.cuekit.yaml` configuration records plus a resolver and prompt renderer. `team start --strategy` creates a team and submits a single coordinator task with the rendered strategy guidance; the coordinator remains responsible for deciding whether and how to submit workers/reviewers. CLI/MCP commands expose strategy discovery and starting, while existing Task Teams remain the durable coordination substrate.

**Tech Stack:** TypeScript, Bun, Zod/incur schemas, YAML project config, cuekit MCP/CLI operations, existing Task Team commands, Vitest/Bun tests, Markdown docs.

---

## References

- Design: `docs/issues/cuekit-team-strategies-design.md`
- Project config guide: `docs/guides/project-config.md`
- Example config: `.cuekit.example.yaml`
- Project config schema: `packages/project-config/src/schema.ts`
- Project config defaults: `packages/project-config/src/apply.ts`
- MCP/CLI registration: `packages/mcp/src/operations.ts`
- Team creation: `packages/mcp/src/commands/create-team.ts`
- Team submit: `packages/mcp/src/commands/submit-team-tasks.ts`
- Submit task: `packages/mcp/src/commands/submit-task.ts`

## File Map

- `packages/project-config/src/schema.ts` — add strategy config schema and exported types.
- `packages/project-config/__tests__/schema.test.ts` — test valid/invalid strategy config.
- `packages/project-config/src/init.ts` — include commented/example strategy in generated config only if useful; otherwise update only docs/example.
- `packages/project-config/__tests__/init.test.ts` — update generated config snapshot/expectations if template changes.
- `.cuekit.example.yaml` — add commented Team Strategies example using `checks`.
- `docs/guides/project-config.md` — document strategies, field semantics, precedence, and safety rules.
- `packages/mcp/src/team-strategy.ts` — new resolver/prompt-renderer module for MCP commands.
- `packages/mcp/__tests__/team-strategy.test.ts` — unit tests for strategy resolution/rendering.
- `packages/mcp/src/commands/list-strategies.ts` — new CLI/MCP command helper for strategy list/show.
- `packages/mcp/src/commands/start-team-strategy.ts` — new command to create team and submit coordinator.
- `packages/mcp/src/operations.ts` — register `strategy list`, `strategy show`, `team start`, and MCP `start_team_strategy` / grouped list integration.
- `packages/mcp/__tests__/commands.test.ts` — command behavior tests.
- `packages/mcp/__tests__/cli.test.ts` — CLI path and MCP tool surface tests.
- `packages/mcp/__tests__/mcp-stdio-integ.test.ts` — MCP tool list integration tests.
- `README.md` — high-level mention and example.

---

## Chunk 1: Config Schema and Documentation

### Task 1: Add Team Strategy schema to project config

**Files:**
- Modify: `packages/project-config/src/schema.ts`
- Modify: `packages/project-config/__tests__/schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests for:

```ts
CuekitProjectConfigSchema.parse({
  strategies: {
    "docs-polish": {
      description: "Docs polish",
      intent: "Make a minimal docs-only improvement.",
      recommended_team: {
        coordinator: { position: "coordinator", role: "planner", agent: "pi", model: "k2p5" },
        worker: { position: "worker", role: "worker", agent: "pi", model: "k2p5" },
        reviewer: { position: "reviewer", role: "reviewer", agent: "claude-code", model: "sonnet" },
      },
      guardrails: ["docs-only"],
      success_criteria: ["meaning preserved"],
      checks: ["git diff --check", "bun run check"],
      autonomy: {
        allow_additional_workers: true,
        allow_parallel_reviewers: false,
        require_reviewer: true,
        allow_skip_checks: false,
      },
    },
  },
});
```

Also add rejection tests:

```ts
expect(() => CuekitProjectConfigSchema.parse({
  strategies: { bad: { validation: ["bun test"] } },
})).toThrow();

expect(() => CuekitProjectConfigSchema.parse({
  strategies: { bad: { recommended_team: { worker: { position: "manager" } } } },
})).toThrow();
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```sh
bun test packages/project-config/__tests__/schema.test.ts -t "strategies"
```

Expected: FAIL because `strategies` is an unknown top-level key.

- [ ] **Step 3: Implement schema**

In `packages/project-config/src/schema.ts`, add:

```ts
export const StrategySlotSchema = z
  .object({
    position: z.enum(["coordinator", "worker", "reviewer", "observer"]).optional(),
    role: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    objective: z.string().min(1).optional(),
    adapter_options: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const TeamStrategySchema = z
  .object({
    description: z.string().min(1).optional(),
    intent: z.string().min(1).optional(),
    recommended_team: z.record(z.string().min(1), StrategySlotSchema).optional(),
    guardrails: z.array(z.string().min(1)).optional(),
    success_criteria: z.array(z.string().min(1)).optional(),
    checks: z.array(z.string().min(1)).optional(),
    autonomy: z
      .object({
        allow_additional_workers: z.boolean().optional(),
        allow_parallel_reviewers: z.boolean().optional(),
        require_reviewer: z.boolean().optional(),
        allow_skip_checks: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
```

Then add `strategies: z.record(z.string().min(1), TeamStrategySchema).optional()` to `CuekitProjectConfigSchema`.

Export:

```ts
export type TeamStrategy = z.infer<typeof TeamStrategySchema>;
export type TeamStrategySlot = z.infer<typeof StrategySlotSchema>;
```

- [ ] **Step 4: Run tests**

```sh
bun test packages/project-config/__tests__/schema.test.ts -t "strategies"
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/project-config/src/schema.ts packages/project-config/__tests__/schema.test.ts
git commit -m "Add team strategy config schema"
```

### Task 2: Document strategy config and example

**Files:**
- Modify: `.cuekit.example.yaml`
- Modify: `docs/guides/project-config.md`
- Modify: `packages/project-config/src/init.ts` only if generated template should include a short commented strategy example.
- Modify: `packages/project-config/__tests__/init.test.ts` only if `init.ts` changes.

- [ ] **Step 1: Update `.cuekit.example.yaml`**

Add a commented or active example:

```yaml
strategies:
  docs-polish:
    description: "Small README/docs improvements"
    intent: "Make minimal docs-only changes and verify meaning is preserved."
    recommended_team:
      coordinator:
        position: coordinator
        role: planner
        agent: pi
      worker:
        position: worker
        role: worker
        agent: pi
      reviewer:
        position: reviewer
        role: reviewer
        agent: claude-code
        model: sonnet
    guardrails:
      - "Keep changes docs-only."
      - "Do not commit/push/PR unless explicitly requested."
    success_criteria:
      - "Diff is limited to README/docs."
      - "Meaning is preserved."
    checks:
      - "git diff --check"
      - "bun run check"
    autonomy:
      allow_additional_workers: true
      require_reviewer: true
```

- [ ] **Step 2: Update project config guide**

Add a `## Team Strategies` section explaining:

- strategies are prompt guidance, not workflows,
- `checks` are recommended confidence checks, not mandatory CI,
- recommended team slots are suggestions for the coordinator,
- explicit request fields win over strategy fields,
- strategy-derived config follows safe adapter permission behavior.

- [ ] **Step 3: Update schema reference**

Add top-level `strategies` and field bullets to the schema reference.

- [ ] **Step 4: Run docs checks**

```sh
bun run check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add .cuekit.example.yaml docs/guides/project-config.md packages/project-config/src/init.ts packages/project-config/__tests__/init.test.ts
git commit -m "Document team strategies config"
```

---

## Chunk 2: Strategy Resolver and Prompt Renderer

### Task 3: Add resolver and prompt rendering module

**Files:**
- Create: `packages/mcp/src/team-strategy.ts`
- Create: `packages/mcp/__tests__/team-strategy.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Create tests for:

```ts
const strategy = resolveTeamStrategy(config, "docs-polish");
expect(strategy.ok).toBe(true);
expect(strategy.strategy_name).toBe("docs-polish");
```

Missing strategy:

```ts
expect(resolveTeamStrategy(config, "missing")).toEqual({
  ok: false,
  error: { code: "strategy_not_found", message: expect.stringContaining("missing") },
});
```

- [ ] **Step 2: Write failing render tests**

Test that rendered prompt contains:

- `Team strategy: docs-polish`
- `Intent:`
- `Recommended team:`
- `Guardrails:`
- `Success criteria:`
- `Checks:`
- `submit_team_tasks`
- `follow_new_tasks`
- no `validation` heading.

- [ ] **Step 3: Run tests and verify failure**

```sh
bun test packages/mcp/__tests__/team-strategy.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 4: Implement module**

Implement:

```ts
export type ResolveTeamStrategyResult =
  | { ok: true; strategy_name: string; strategy: TeamStrategy }
  | { ok: false; error: { code: "strategy_not_found"; message: string } };

export function resolveTeamStrategy(config: CuekitProjectConfig, name: string): ResolveTeamStrategyResult;

export function renderTeamStrategyPrompt(input: {
  strategy_name: string;
  strategy: TeamStrategy;
  objective: string;
}): string;
```

Rendering must be deterministic and concise. Slot rendering should include only present fields.

- [ ] **Step 5: Run tests**

```sh
bun test packages/mcp/__tests__/team-strategy.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add packages/mcp/src/team-strategy.ts packages/mcp/__tests__/team-strategy.test.ts
git commit -m "Render team strategy prompts"
```

---

## Chunk 3: Strategy Discovery Commands

### Task 4: Add strategy list/show commands

**Files:**
- Create: `packages/mcp/src/commands/list-strategies.ts`
- Modify: `packages/mcp/src/operations.ts`
- Modify: `packages/mcp/__tests__/commands.test.ts`
- Modify: `packages/mcp/__tests__/cli.test.ts`

- [ ] **Step 1: Write failing command tests**

Create a temp project with `.cuekit.yaml` containing two strategies. Test:

```ts
const result = runListStrategies(ctx, { cwd: root });
expect(result.strategies.map((s) => s.name)).toEqual(["bugfix", "docs-polish"]);
```

Show one strategy:

```ts
const result = runListStrategies(ctx, { cwd: root, strategy: "docs-polish", include_prompt: true, objective: "Polish README" });
expect(result.strategy?.name).toBe("docs-polish");
expect(result.strategy?.rendered_prompt).toContain("Checks:");
```

Missing config or missing strategy should return structured errors:

- `project_config_not_found` or empty list for no config (choose one and document it)
- `strategy_not_found` for unknown strategy in an existing config

Recommendation: no config returns `{ strategies: [] }`; unknown named strategy returns `strategy_not_found`.

- [ ] **Step 2: Run tests and verify failure**

```sh
bun test packages/mcp/__tests__/commands.test.ts -t "strategy"
```

Expected: FAIL because command does not exist.

- [ ] **Step 3: Implement `list-strategies.ts`**

Input schema:

```ts
export const ListStrategiesInputSchema = z.object({
  cwd: z.string().min(1).optional(),
  strategy: z.string().min(1).optional(),
  include_prompt: z.boolean().optional(),
  objective: z.string().min(1).optional(),
});
```

Output schema:

```ts
z.union([
  z.object({ strategies: z.array(StrategySummarySchema) }),
  z.object({ strategy: StrategyDetailSchema }),
  z.object({ error: z.object({ code: z.literal("strategy_not_found"), message: z.string() }) }),
])
```

Use `loadProjectConfig(cwd ?? process.cwd())` and existing config discovery behavior.

- [ ] **Step 4: Register CLI path**

Add CLI operations:

- `strategy list`
- `strategy show`

If `operations.ts` cannot express both paths with one command cleanly, create separate wrappers or add two operations using the same runner with different schemas.

- [ ] **Step 5: Update CLI tests**

Assert `cliPaths` contains:

- `strategy list`
- `strategy show`

Do not add setup helpers to MCP unless chosen in Task 5.

- [ ] **Step 6: Run tests**

```sh
bun test packages/mcp/__tests__/commands.test.ts -t "strategy"
bun test packages/mcp/__tests__/cli.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add packages/mcp/src/commands/list-strategies.ts packages/mcp/src/operations.ts packages/mcp/__tests__/commands.test.ts packages/mcp/__tests__/cli.test.ts
git commit -m "Add strategy discovery commands"
```

---

## Chunk 4: Start Strategy-Backed Teams

### Task 5: Add `team start --strategy`

**Files:**
- Create: `packages/mcp/src/commands/start-team-strategy.ts`
- Modify: `packages/mcp/src/operations.ts`
- Modify: `packages/mcp/__tests__/commands.test.ts`
- Modify: `packages/mcp/__tests__/cli.test.ts`

- [ ] **Step 1: Write failing command test**

Temp `.cuekit.yaml`:

```yaml
project:
  id: strategy-test
strategies:
  docs-polish:
    description: Docs polish
    intent: Keep docs-only.
    recommended_team:
      coordinator:
        position: coordinator
        role: planner
        agent: pi
        model: k2p5
      reviewer:
        position: reviewer
        role: reviewer
        agent: claude-code
    checks:
      - git diff --check
```

Test:

```ts
const result = await runStartTeamStrategy(ctx, {
  cwd: root,
  strategy: "docs-polish",
  objective: "Polish README wait guidance",
});
expect(result.accepted).toBe(true);
expect(result.team_id).toMatch(/^tm_/);
expect(result.coordinator_task_id).toMatch(/^t_/);
const task = getTaskById(db, result.coordinator_task_id);
expect(task?.team_position).toBe("coordinator");
const spec = JSON.parse(task?.spec_json ?? "{}");
expect(spec.team_context?.position).toBe("coordinator");
expect(spec.context).toContain("Team strategy: docs-polish");
expect(spec.context).toContain("Checks:");
```

- [ ] **Step 2: Add explicit override test**

Caller can override coordinator fields:

```ts
const result = await runStartTeamStrategy(ctx, {
  cwd: root,
  strategy: "docs-polish",
  objective: "x",
  coordinator: { agent_kind: "claude-code", model: "sonnet", role: "planner" },
});
expect(result.agent_kind).toBe("claude-code");
```

- [ ] **Step 3: Run tests and verify failure**

```sh
bun test packages/mcp/__tests__/commands.test.ts -t "start team strategy"
```

Expected: FAIL because command does not exist.

- [ ] **Step 4: Implement command**

Input schema:

```ts
export const StartTeamStrategyInputSchema = z.object({
  strategy: z.string().min(1),
  objective: z.string().min(1),
  title: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
  coordinator: z.object({
    role: z.string().min(1).optional(),
    agent_kind: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    timeout_ms: z.union([z.number().int().positive(), z.null()]).optional(),
    adapter_options: z.record(z.string(), z.unknown()).optional(),
  }).strict().optional(),
});
```

Output schema:

```ts
export const StartTeamStrategyOutputSchema = z.union([
  z.object({
    accepted: z.literal(true),
    team_id: z.string(),
    coordinator_task_id: z.string(),
    strategy: z.string(),
    agent_kind: z.string(),
    role: z.string().optional(),
    model: z.string().optional(),
  }),
  z.object({
    accepted: z.literal(false),
    error: z.object({
      code: z.enum([
        "invalid_project_config",
        "strategy_not_found",
        "team_create_failed",
        "coordinator_submit_failed",
      ]),
      message: z.string(),
    }),
  }),
]);
```

Implementation steps:

1. Load project config from `cwd` or session worktree. Return `invalid_project_config` if config loading fails.
2. Resolve strategy. Return `strategy_not_found` for unknown strategy names.
3. Create team with title default: `${strategy}: ${objective.slice(0, 80)}`. If `runCreateTeam` returns an error, wrap it as `team_create_failed`.
4. Resolve the coordinator slot from `strategy.recommended_team.coordinator`.
5. Resolve coordinator fields with the design precedence:
   1. explicit `input.coordinator` fields,
   2. strategy coordinator slot fields,
   3. `.cuekit.yaml` `teams.roles.coordinator` for role only,
   4. `.cuekit.yaml` `submit` defaults via `runSubmitTask`,
   5. validation/submit error if no agent can be resolved.
6. Resolve coordinator adapter options explicitly:
   - If `input.coordinator.adapter_options` is present, pass it through unchanged; caller intent wins.
   - Else if the strategy coordinator slot has `adapter_options`, merge those options **and** force `dangerously_skip_permissions: false`. Strategy-derived adapter options are project config, so they must not silently enable permission bypass.
   - Else if any executable coordinator field (`role`, `agent_kind`, or `model`) came from the strategy, pass `dangerously_skip_permissions: false`.
   - Else leave adapter options to existing `runSubmitTask` project-config safety behavior.
7. Build coordinator `context` by appending rendered strategy prompt.
8. Call `runSubmitTask` with `team_id`, `position: "coordinator"`, resolved role/agent/model, strategy context, resolved timeout, and resolved adapter options. Use `position`, not `team_position`; `SubmitTaskInputSchema` does not accept `team_position`.
9. If `runSubmitTask` rejects the coordinator, delete the empty team if possible or leave it with a clear `coordinator_submit_failed` error; do not pretend the team started.
10. Return team and coordinator task ids plus selected coordinator fields.

Do not submit worker/reviewer tasks in v1.

- [ ] **Step 5: Register CLI path**

Add CLI operation:

```ts
cliPath: ["team", "start"]
```

Description should state that this starts a coordinator-led team from a strategy.

- [ ] **Step 6: Run tests**

```sh
bun test packages/mcp/__tests__/commands.test.ts -t "start team strategy"
bun test packages/mcp/__tests__/cli.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add packages/mcp/src/commands/start-team-strategy.ts packages/mcp/src/operations.ts packages/mcp/__tests__/commands.test.ts packages/mcp/__tests__/cli.test.ts
git commit -m "Start coordinator teams from strategies"
```

### Task 6: Add MCP `start_team_strategy`

**Files:**
- Modify: `packages/mcp/src/operations.ts`
- Modify: `packages/mcp/__tests__/cli.test.ts`
- Modify: `packages/mcp/__tests__/mcp-stdio-integ.test.ts`
- Modify: `README.md`
- Modify: `docs/decisions/002-grouped-mcp-surface.md`

- [ ] **Step 1: Write failing MCP tool list tests**

Update expected MCP tools to include `start_team_strategy`.

Run:

```sh
bun test packages/mcp/__tests__/cli.test.ts packages/mcp/__tests__/mcp-stdio-integ.test.ts
```

Expected: FAIL until operation is registered.

- [ ] **Step 2: Register MCP operation**

Add:

```ts
defineMcpOperation({
  mcpName: "start_team_strategy",
  cliPath: ["team", "start"],
  description: "Create a team and submit a coordinator task using a project Team Strategy.",
  options: StartTeamStrategyInputSchema,
  output: StartTeamStrategyOutputSchema,
  run: runStartTeamStrategy,
})
```

- [ ] **Step 3: Update docs**

Mention `start_team_strategy` in README MCP tool list and ADR 002 grouped MCP surface.

- [ ] **Step 4: Run tests**

```sh
bun test packages/mcp/__tests__/cli.test.ts packages/mcp/__tests__/mcp-stdio-integ.test.ts
bun run typecheck
bun run check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/mcp/src/operations.ts packages/mcp/__tests__/cli.test.ts packages/mcp/__tests__/mcp-stdio-integ.test.ts README.md docs/decisions/002-grouped-mcp-surface.md
git commit -m "Expose strategy-backed team start over MCP"
```

---

## Chunk 5: Dogfood and Follow-Up Hardening

### Task 7: Dogfood docs strategy

**Files:**
- Modify: `.cuekit.example.yaml` or project-local `.cuekit.yaml` only if intentionally adding a committed cuekit strategy for this repo.
- Modify: docs only if dogfood reveals UX gaps.

- [ ] **Step 1: Add or use a `docs-polish` strategy**

If `.cuekit.yaml` is not committed, use `.cuekit.example.yaml` as reference and pass a temp config in a clean worktree, or create a local uncommitted `.cuekit.yaml` for dogfood.

- [ ] **Step 2: Start a strategy-backed team**

Use MCP or CLI:

```sh
cuekit team start --strategy docs-polish --objective "Polish one sentence in README" --cwd /Users/kawasakiisao/Desktop/ai/cuekit
```

- [ ] **Step 3: Wait with dynamic membership**

```json
{
  "kind": "team",
  "team_id": "tm_...",
  "follow_new_tasks": true,
  "timeout_ms": 45000,
  "poll_interval_ms": 5000,
  "include_events": true
}
```

- [ ] **Step 4: Inspect result**

```sh
cuekit team result --team_id tm_...
```

Expected: timeline includes coordinator, worker, reviewer events and final coordinator summary.

- [ ] **Step 5: Cleanup**

```sh
cuekit cleanup target --kind team --team_id tm_...
cuekit delete target --kind team --team_id tm_...
```

- [ ] **Step 6: Capture follow-ups**

If dogfood reveals issues, create GitHub issues rather than expanding the current PR.

### Task 8: Final validation

**Files:**
- All touched files.

- [ ] **Step 1: Full validation**

```sh
bun test
bun run typecheck
bun run check
```

Expected: PASS.

- [ ] **Step 2: Review**

Dispatch reviewer subagent with:

```text
Review Team Strategies implementation. Focus on preserving coordinator autonomy, avoiding workflow-engine behavior, config safety, prompt rendering accuracy, MCP/CLI shape, and test coverage.
```

Expected: `No issues found` or fix findings.

- [ ] **Step 3: PR and merge**

Use GitButler flow:

```sh
but status --status-after
but push <branch>
gh pr create --base main --head <branch> --title "Add team strategies" --body-file /tmp/pr-team-strategies.md
gh pr merge <PR> --squash --delete-branch
```

---

## Suggested GitHub Issue Split

1. **Add Team Strategy config schema and docs** — Chunk 1.
2. **Render Team Strategy coordinator prompts** — Chunk 2.
3. **Add strategy list/show commands** — Chunk 3.
4. **Start coordinator teams from strategies** — Chunk 4 Task 5.
5. **Expose strategy-backed team start over MCP** — Chunk 4 Task 6.
6. **Dogfood Team Strategies and capture UX gaps** — Chunk 5.

Each issue should link this plan and `docs/issues/cuekit-team-strategies-design.md`.
