# Herdr Multiplexer Backend Implementation Plan

> **For agentic workers:** REQUIRED: Use TDD for every implementation issue. Steps use checkbox (`- [ ]`) syntax for tracking. Keep PRs small; each issue below should be implementable independently by an AI coding worker.

**Goal:** Add an experimental `herdr` multiplexer backend that maps cuekit tasks and teams onto Herdr sessions, workspaces, tabs, and panes while preserving the existing `MultiplexerBackend` contract.

**Architecture:** Implement Herdr below `@cuekit/adapters` as another `MultiplexerBackend`. Use one Herdr named session per cuekit project/runtime namespace, solo tasks as one cuekit-owned workspace with a root pane, and team tasks as one workspace with one pane per member in a later phase. Persist full Herdr coordinates in `native_task_ref` as `herdr:<session>/<workspace_id>/<tab_id>/<pane_id>` and validate workspace/tab before any live operation because Herdr pane ids can compact.

**Tech Stack:** TypeScript, Bun test, Zod, cuekit `MultiplexerBackend`, Herdr Unix socket API / CLI, fake runner tests, optional real-Herdr integration tests.

**Design reference:** [`docs/designs/cuekit-herdr-multiplexer-backend-design.md`](../designs/cuekit-herdr-multiplexer-backend-design.md)

---

## Implementation Principles

1. **No production code without failing tests first.** Each issue below starts with tests that must fail for the expected reason.
2. **Socket API preferred.** Use Herdr JSON socket semantics in the runner abstraction; CLI can be a fallback/probe layer, but backend code should consume typed runner methods.
3. **Never trust pane ids alone.** Every restored operation validates session/workspace/tab before steering, capture, liveness, or kill.
4. **Secrets stay out of argv and labels.** If Herdr only supports `pane.run` as input into an existing shell, run a cuekit-created `0600` launch script that sources a `0600` env file.
5. **Solo first, team later.** Ship useful solo task support before team workspace support. Role tabs are deferred polish.

## File Map

- Create: `packages/adapters/src/herdr-coordinate.ts`
  - Pure parsing/formatting for Herdr session names and `native_task_ref` coordinates.
- Create: `packages/adapters/__tests__/herdr-coordinate.test.ts`
  - Unit tests for coordinate parsing, malformed refs, session-name sanitization.
- Modify: `packages/project-config/src/schema.ts`
  - Add `herdr` to `MultiplexerSchema`.
- Modify: `packages/project-config/__tests__/schema.test.ts`
  - Config accepts `multiplexer: herdr` and rejects unknown values.
- Modify: `packages/adapters/src/build-multiplexer.ts`
  - Add `herdr` selection/probe/fallback.
- Modify: `packages/adapters/__tests__/build-multiplexer.test.ts`
  - Herdr build/fallback/strict tests.
- Create: `packages/adapters/src/herdr-runner.ts`
  - Production runner boundary for Herdr CLI/socket calls.
- Modify: `packages/adapters/src/testing.ts`
  - Add `FakeHerdrRunner` with sessions, workspaces, tabs, panes, and pane-id compaction simulation.
- Create: `packages/adapters/__tests__/herdr-runner.test.ts`
  - Runner command/request behavior tests where useful.
- Create: `packages/adapters/src/herdr-backend.ts`
  - `HerdrBackend implements MultiplexerBackend` for solo task support first.
- Create: `packages/adapters/__tests__/herdr-backend.test.ts`
  - Solo backend contract tests.
- Modify: `packages/adapters/src/index.ts`
  - Export Herdr backend/runner/coordinate helpers.
- Modify: `packages/cli/src/doctor.ts`
  - Add Herdr binary probe row.
- Modify: `packages/cli/__tests__/doctor.test.ts`
  - Doctor output expectations.
- Modify: `docs/guides/multiplexer-backends.md`
  - Add Herdr opt-in and smoke recipe.
- Modify: `docs/guides/README.md`
  - Link Herdr backend guide/section if split out.
- Create optional: `packages/adapters/__tests__/herdr-backend-integ.test.ts`
  - Opt-in real Herdr integration test, skipped unless `CUEKIT_HERDR_INTEG=1` and `herdr` is installed.

---

## Issue 1: [#474 Config and coordinate foundation for `herdr`](https://github.com/takemo101/cuekit/issues/474)

**Outcome:** cuekit accepts `multiplexer.backend: herdr`; `buildMultiplexerBackend` can select or fall back from a skeleton Herdr backend; pure coordinate helpers parse/format Herdr native refs and sanitized session names. No real task spawning yet.

**Files:**
- Create: `packages/adapters/src/herdr-coordinate.ts`
- Create: `packages/adapters/__tests__/herdr-coordinate.test.ts`
- Modify: `packages/project-config/src/schema.ts`
- Modify: `packages/project-config/__tests__/schema.test.ts`
- Modify: `packages/adapters/src/build-multiplexer.ts`
- Modify: `packages/adapters/__tests__/build-multiplexer.test.ts`
- Create minimal: `packages/adapters/src/herdr-backend.ts`
- Modify: `packages/adapters/src/index.ts`

- [ ] **Step 1: Write failing coordinate helper tests**

Create `packages/adapters/__tests__/herdr-coordinate.test.ts` covering:

```ts
import {
  formatHerdrNativeTaskRef,
  parseHerdrNativeTaskRef,
  sanitizeHerdrSessionName,
} from "../src/herdr-coordinate.ts";

test("formats and parses full herdr native task refs", () => {
  const ref = formatHerdrNativeTaskRef({
    session: "ck-cuekit",
    workspaceId: "w64e95948145ed1",
    tabId: "w64e95948145ed1:1",
    paneId: "w64e95948145ed1-1",
  });
  expect(ref).toBe("herdr:ck-cuekit/w64e95948145ed1/w64e95948145ed1:1/w64e95948145ed1-1");
  expect(parseHerdrNativeTaskRef(ref)).toEqual({
    session: "ck-cuekit",
    workspaceId: "w64e95948145ed1",
    tabId: "w64e95948145ed1:1",
    paneId: "w64e95948145ed1-1",
  });
});

test("rejects malformed or non-herdr native refs", () => {
  expect(parseHerdrNativeTaskRef("tmux:%1")).toBeNull();
  expect(parseHerdrNativeTaskRef("herdr:missing/pieces")).toBeNull();
  expect(parseHerdrNativeTaskRef("herdr:default/w/t/p")).toBeNull();
});

test("sanitizes herdr session names and avoids reserved default", () => {
  expect(sanitizeHerdrSessionName("cuekit repo/main")).toBe("cuekit-repo-main");
  expect(sanitizeHerdrSessionName("default")).toBe("ck-default");
});
```

- [ ] **Step 2: Run coordinate tests and verify RED**

```sh
bun test packages/adapters/__tests__/herdr-coordinate.test.ts
```

Expected: fails because helper module does not exist.

- [ ] **Step 3: Implement minimal coordinate helpers**

Implement a small, pure module. Session names must allow only ASCII letters, numbers, `.`, `_`, `-`, collapse other chars to `-`, trim repeated separators, and avoid `default`.

- [ ] **Step 4: Verify coordinate tests GREEN**

```sh
bun test packages/adapters/__tests__/herdr-coordinate.test.ts
```

- [ ] **Step 5: Write failing project-config tests**

In `packages/project-config/__tests__/schema.test.ts`, add expectations that `multiplexer: "herdr"` and `{ backend: "herdr", strict: true }` parse, and unknown values still fail.

- [ ] **Step 6: Run config tests and verify RED**

```sh
bun test packages/project-config/__tests__/schema.test.ts
```

Expected: fails because schema enum does not include `herdr`.

- [ ] **Step 7: Add `herdr` to project config schema**

Modify `MultiplexerSchema` to `z.enum(["tmux", "zellij", "herdr"])` and update exported type usage if TypeScript requires it.

- [ ] **Step 8: Verify config tests GREEN**

```sh
bun test packages/project-config/__tests__/schema.test.ts
```

- [ ] **Step 9: Write failing build-multiplexer tests**

In `packages/adapters/__tests__/build-multiplexer.test.ts`, add tests:

```ts
it("returns herdr when configured and herdr probes ok", async () => {
  const result = await buildMultiplexerBackend(
    { multiplexer: { backend: "herdr", strict: false } },
    { probe: { herdr: true } },
  );
  expect(result.requested).toBe("herdr");
  expect(result.backend.kind).toBe("herdr");
  expect(result.fallbackApplied).toBe(false);
});

it("falls back to tmux when herdr probe fails and strict is false", async () => {
  const warnings: string[] = [];
  const result = await buildMultiplexerBackend(
    { multiplexer: "herdr" },
    { probe: { herdr: false, tmux: true }, logger: { warn: (m) => warnings.push(String(m)) } as never },
  );
  expect(result.requested).toBe("herdr");
  expect(result.backend.kind).toBe("tmux");
  expect(result.fallbackApplied).toBe(true);
  expect(warnings.join("\n")).toContain("herdr");
});

it("hard-fails when herdr probe fails and strict is true", async () => {
  await expect(
    buildMultiplexerBackend({ multiplexer: { backend: "herdr", strict: true } }, { probe: { herdr: false } }),
  ).rejects.toThrow(/strict.*herdr.*failed/i);
});
```

- [ ] **Step 10: Run build-multiplexer tests and verify RED**

```sh
bun test packages/adapters/__tests__/build-multiplexer.test.ts
```

- [ ] **Step 11: Add skeleton `HerdrBackend` and build plumbing**

Create `packages/adapters/src/herdr-backend.ts` with `readonly kind = "herdr"` and methods throwing `new Error("HerdrBackend operation not implemented yet")` except `sessionNameFor`/`attachCommand` if trivial. Export it. Extend `MultiplexerConfigSlice`, `BuiltMultiplexer.requested`, probes, fallback warnings, and `BuildMultiplexerOptions.probe.herdr`.

- [ ] **Step 12: Verify issue tests and typecheck**

```sh
bun test packages/adapters/__tests__/herdr-coordinate.test.ts packages/adapters/__tests__/build-multiplexer.test.ts packages/project-config/__tests__/schema.test.ts
bun run typecheck
```

- [ ] **Step 13: Commit**

```sh
git add packages/adapters/src/herdr-coordinate.ts packages/adapters/src/herdr-backend.ts packages/adapters/src/build-multiplexer.ts packages/adapters/src/index.ts packages/adapters/__tests__/herdr-coordinate.test.ts packages/adapters/__tests__/build-multiplexer.test.ts packages/project-config/src/schema.ts packages/project-config/__tests__/schema.test.ts
git commit -m "feat: add herdr multiplexer config foundation"
```

---

## Issue 2: [#475 Add typed Herdr runner and fake Herdr runtime](https://github.com/takemo101/cuekit/issues/475)

**Outcome:** `@cuekit/adapters` has a typed Herdr runner boundary plus a fake runtime for deterministic backend tests. The fake supports sessions, workspaces, tabs, panes, command injection, reading output, sending input, closing panes/workspaces, and pane-id compaction.

**Files:**
- Create: `packages/adapters/src/herdr-runner.ts`
- Modify: `packages/adapters/src/herdr-backend.ts` only to accept runner/session options, if needed
- Modify: `packages/adapters/src/testing.ts`
- Create: `packages/adapters/__tests__/herdr-runner.test.ts`
- Modify: `packages/adapters/src/index.ts`

- [ ] **Step 1: Write failing fake runner tests**

Create `packages/adapters/__tests__/herdr-runner.test.ts` and test the fake API shape, not Herdr itself:

```ts
import { FakeHerdrRunner } from "../src/testing.ts";

test("fake herdr creates a workspace with root tab and pane", async () => {
  const runner = new FakeHerdrRunner();
  const workspace = await runner.createWorkspace({ session: "ck-test", cwd: "/tmp/project", label: "task t_1" });
  expect(workspace.workspace_id).toMatch(/^w/);
  expect(workspace.tab_id).toContain(":1");
  expect(workspace.root_pane_id).toContain("-1");
  await expect(runner.getPane({ session: "ck-test", paneId: workspace.root_pane_id })).resolves.toMatchObject({
    pane_id: workspace.root_pane_id,
    workspace_id: workspace.workspace_id,
    tab_id: workspace.tab_id,
  });
});

test("fake herdr run/send/read records terminal text", async () => {
  const runner = new FakeHerdrRunner();
  const ws = await runner.createWorkspace({ session: "ck-test", cwd: "/tmp/project", label: "task t_1" });
  await runner.runInPane({ session: "ck-test", paneId: ws.root_pane_id, command: "echo hi" });
  await runner.sendInput({ session: "ck-test", paneId: ws.root_pane_id, text: "next", keys: ["Enter"] });
  const read = await runner.readPane({ session: "ck-test", paneId: ws.root_pane_id, source: "recent", lines: 20 });
  expect(read.text).toContain("echo hi");
  expect(read.text).toContain("next");
});

test("fake herdr compacts pane ids after close", async () => {
  const runner = new FakeHerdrRunner();
  const ws = await runner.createWorkspace({ session: "ck-test", cwd: "/tmp/project", label: "team tm_1" });
  const second = await runner.splitPane({ session: "ck-test", targetPaneId: ws.root_pane_id, direction: "right", cwd: "/tmp/project" });
  expect(second.pane_id).toMatch(/-2$/);
  await runner.closePane({ session: "ck-test", paneId: ws.root_pane_id });
  await expect(runner.getPane({ session: "ck-test", paneId: second.pane_id })).rejects.toThrow(/pane_not_found|compacted/i);
});
```

- [ ] **Step 2: Run tests and verify RED**

```sh
bun test packages/adapters/__tests__/herdr-runner.test.ts
```

- [ ] **Step 3: Implement `HerdrRunner` interface and fake**

Define result types close to Herdr API docs:

```ts
export interface HerdrRunner {
  probe(): Promise<boolean>;
  createWorkspace(params: { session: string; cwd: string; label?: string }): Promise<{ workspace_id: string; tab_id: string; root_pane_id: string }>;
  getPane(params: { session: string; paneId: string }): Promise<{ pane_id: string; workspace_id: string; tab_id: string; agent_status?: string }>;
  listPanes(params: { session: string; workspaceId?: string }): Promise<Array<{ pane_id: string; workspace_id: string; tab_id: string }>>;
  splitPane(params: { session: string; targetPaneId: string; direction: "right" | "down"; cwd?: string }): Promise<{ pane_id: string; workspace_id: string; tab_id: string }>;
  runInPane(params: { session: string; paneId: string; command: string }): Promise<void>;
  sendInput(params: { session: string; paneId: string; text: string; keys: string[] }): Promise<void>;
  readPane(params: { session: string; paneId: string; source: "visible" | "recent" | "recent_unwrapped"; lines?: number }): Promise<{ text: string }>;
  closePane(params: { session: string; paneId: string }): Promise<void>;
  closeWorkspace(params: { session: string; workspaceId: string }): Promise<void>;
}
```

Keep production runner methods simple wrappers or TODO-safe where not used yet; fake must be complete enough for backend unit tests.

- [ ] **Step 4: Verify fake runner tests GREEN**

```sh
bun test packages/adapters/__tests__/herdr-runner.test.ts
```

- [ ] **Step 5: Commit**

```sh
git add packages/adapters/src/herdr-runner.ts packages/adapters/src/testing.ts packages/adapters/src/index.ts packages/adapters/__tests__/herdr-runner.test.ts packages/adapters/src/herdr-backend.ts
git commit -m "test: add fake herdr runner"
```

---

## Issue 3: [#476 Implement solo-task `HerdrBackend` operations](https://github.com/takemo101/cuekit/issues/476)

**Outcome:** `HerdrBackend` supports solo task `spawnPane`, `restorePaneHandle`, `isAlive`, `sendKeys`, `capturePane`, `killPane`, and `attachCommand` against `FakeHerdrRunner`. It persists full coordinates and refuses operations on compacted/mismatched panes.

**Files:**
- Modify: `packages/adapters/src/herdr-backend.ts`
- Modify: `packages/adapters/src/herdr-coordinate.ts`
- Create: `packages/adapters/__tests__/herdr-backend.test.ts`
- Modify if needed: `packages/adapters/src/testing.ts`

- [ ] **Step 1: Write failing spawn/attach/capture tests**

Create `packages/adapters/__tests__/herdr-backend.test.ts`:

```ts
import { HerdrBackend } from "../src/herdr-backend.ts";
import { parseHerdrNativeTaskRef } from "../src/herdr-coordinate.ts";
import { FakeHerdrRunner } from "../src/testing.ts";

test("spawns solo task in a cuekit-owned herdr workspace and returns full coordinate", async () => {
  const runner = new FakeHerdrRunner();
  const backend = new HerdrBackend({ runner, sessionName: "ck-test" });
  const handle = await backend.spawnPane({ task_id: "t_abc", cwd: "/repo", command: "echo hello" });
  expect(handle.backend_kind).toBe("herdr");
  expect(handle.backend_session).toBe("ck-test");
  expect(handle.backend_pane_id?.split("/")).toHaveLength(3);
  expect(parseHerdrNativeTaskRef(`herdr:${handle.backend_session}/${handle.backend_pane_id}`)).not.toBeNull();
  expect(backend.attachCommand("t_abc")).toEqual({ argv: ["herdr", "--session", "ck-test"] });
  await expect(backend.capturePane("t_abc", { scrollbackLines: 20 })).resolves.toContain("echo hello");
});
```

- [ ] **Step 2: Write failing steer/liveness/kill tests**

```ts
test("steers with send_input text plus Enter and closes solo workspace on kill", async () => {
  const runner = new FakeHerdrRunner();
  const backend = new HerdrBackend({ runner, sessionName: "ck-test", sendKeysDelayMs: 0 });
  await backend.spawnPane({ task_id: "t_abc", cwd: "/repo", command: "cat" });
  expect(await backend.isAlive("t_abc")).toBe(true);
  await backend.sendKeys("t_abc", "hello from parent");
  expect(await backend.capturePane("t_abc", { scrollbackLines: 20 })).toContain("hello from parent");
  await backend.killPane("t_abc");
  expect(await backend.isAlive("t_abc")).toBe(false);
});
```

- [ ] **Step 3: Write failing restore validation tests**

```ts
test("restored handle validates workspace and tab before operating", async () => {
  const runner = new FakeHerdrRunner();
  const first = new HerdrBackend({ runner, sessionName: "ck-test" });
  const handle = await first.spawnPane({ task_id: "t_abc", cwd: "/repo", command: "cat" });

  const restored = new HerdrBackend({ runner, sessionName: "ck-test" });
  restored.restorePaneHandle?.(handle);
  expect(await restored.isAlive("t_abc")).toBe(true);
  await restored.sendKeys("t_abc", "restored input");
  expect(await restored.capturePane("t_abc")).toContain("restored input");

  runner.forcePaneWorkspaceMismatch(handle.backend_pane_id as string, "wrong-workspace");
  expect(await restored.isAlive("t_abc")).toBe(false);
  await expect(restored.sendKeys("t_abc", "must not land")).rejects.toThrow(/mismatch|not alive/i);
});
```

- [ ] **Step 4: Run backend tests and verify RED**

```sh
bun test packages/adapters/__tests__/herdr-backend.test.ts
```

- [ ] **Step 5: Implement solo backend minimally**

Implement:

- constructor options: `{ runner?: HerdrRunner; sessionName?: string; sendKeysDelayMs?: number }`
- internal task handle map keyed by `task_id`
- `spawnPane`: `runner.createWorkspace`, create launch script/env file if `params.env` exists, `runner.runInPane`, return `PaneHandle`
- `restorePaneHandle`: parse `backend_session` + `backend_pane_id`, ignore non-herdr handles
- `isAlive`: validate `getPane` coordinate
- `sendKeys`: validate then `runner.sendInput({ text: message, keys: ["Enter"] })`
- `capturePane`: validate then `runner.readPane({ source: "recent", lines })`
- `killPane`: close solo workspace idempotently
- `attachCommand`: `herdr --session <session>`

- [ ] **Step 6: Verify backend tests GREEN**

```sh
bun test packages/adapters/__tests__/herdr-backend.test.ts packages/adapters/__tests__/herdr-runner.test.ts packages/adapters/__tests__/build-multiplexer.test.ts
```

- [ ] **Step 7: Run package typecheck**

```sh
bun run typecheck
```

- [ ] **Step 8: Commit**

```sh
git add packages/adapters/src/herdr-backend.ts packages/adapters/src/herdr-coordinate.ts packages/adapters/src/testing.ts packages/adapters/__tests__/herdr-backend.test.ts
git commit -m "feat: implement solo herdr multiplexer backend"
```

---

## Issue 4: [#477 Wire Herdr into docs, doctor, and optional real integration smoke](https://github.com/takemo101/cuekit/issues/477)

**Outcome:** Users can discover and opt into `multiplexer.backend: herdr`; `cuekit doctor` probes Herdr; docs explain Herdr semantics, known limitations, and smoke-test commands. Optional real-Herdr integration tests are available but skipped by default.

**Files:**
- Modify: `packages/cli/src/doctor.ts`
- Modify: `packages/cli/__tests__/doctor.test.ts`
- Modify: `docs/guides/multiplexer-backends.md`
- Modify: `docs/guides/README.md` if a separate Herdr guide is created
- Create optional: `packages/adapters/__tests__/herdr-backend-integ.test.ts`
- Modify: `AGENTS.md` if the implementation changes active project constraints

- [ ] **Step 1: Write failing doctor tests**

Update `packages/cli/__tests__/doctor.test.ts` so configured `multiplexer.backend: herdr` produces a Herdr-specific probe row and does not mention zellij-only requirements.

- [ ] **Step 2: Run doctor tests and verify RED**

```sh
bun test packages/cli/__tests__/doctor.test.ts
```

- [ ] **Step 3: Add Herdr doctor probe**

Add Herdr to the configured multiplexer probe path. Probe `herdr --version` or `herdr status client`; keep auth/session checks informational only.

- [ ] **Step 4: Verify doctor tests GREEN**

```sh
bun test packages/cli/__tests__/doctor.test.ts
```

- [ ] **Step 5: Add docs**

Update `docs/guides/multiplexer-backends.md` with:

```yaml
multiplexer:
  backend: herdr
  strict: false
```

Document:

- Herdr backend is experimental.
- Attach opens the Herdr session, not a single pane.
- Solo task = workspace/root pane.
- `native_task_ref` stores full Herdr coordinate.
- Pane-id compaction is guarded by workspace/tab validation.
- `task_events` remain canonical; Herdr `agent_status` is display-only.

- [ ] **Step 6: Add optional integration test skeleton**

Create `herdr-backend-integ.test.ts` skipped unless `CUEKIT_HERDR_INTEG=1` and `herdr` is on PATH. Smoke:

1. create backend with unique Herdr session name;
2. spawn a command that prints a marker;
3. capture marker;
4. steer a `cat` task;
5. kill and verify not alive;
6. cleanup Herdr session/workspace.

- [ ] **Step 7: Run docs/checks**

```sh
bun test packages/cli/__tests__/doctor.test.ts
bun run check
bun run typecheck
```

- [ ] **Step 8: Commit**

```sh
git add packages/cli/src/doctor.ts packages/cli/__tests__/doctor.test.ts docs/guides/multiplexer-backends.md docs/guides/README.md packages/adapters/__tests__/herdr-backend-integ.test.ts
git commit -m "docs: document herdr multiplexer backend"
```

---

## Issue 5: [#478 Add team-workspace support for Herdr backend](https://github.com/takemo101/cuekit/issues/478)

**Outcome:** `HerdrBackend` groups cuekit team member tasks into a shared Herdr workspace, creates one pane per member, validates restored coordinates, and implements `killTeamSession` by closing the cuekit-owned team workspace. Role tabs remain deferred.

**Files:**
- Modify: `packages/adapters/src/herdr-backend.ts`
- Modify: `packages/adapters/src/testing.ts`
- Modify: `packages/adapters/__tests__/herdr-backend.test.ts`
- Modify: `docs/designs/cuekit-herdr-multiplexer-backend-design.md` if implementation discovers design corrections
- Modify: `docs/guides/multiplexer-backends.md`

- [ ] **Step 1: Write failing shared-team-workspace test**

Add to `herdr-backend.test.ts`:

```ts
test("team member tasks share one herdr workspace with separate panes", async () => {
  const runner = new FakeHerdrRunner();
  const backend = new HerdrBackend({ runner, sessionName: "ck-test" });
  const coordinator = await backend.spawnPane({ task_id: "t_coord", team_id: "tm_1", team_position: "coordinator", cwd: "/repo", command: "coord" });
  const worker = await backend.spawnPane({ task_id: "t_worker", team_id: "tm_1", team_position: "worker", cwd: "/repo", command: "worker" });
  const [, coordWorkspace] = (coordinator.backend_pane_id as string).split("/");
  const [, workerWorkspace] = (worker.backend_pane_id as string).split("/");
  expect(workerWorkspace).toBe(coordWorkspace);
  expect(worker.backend_pane_id).not.toBe(coordinator.backend_pane_id);
});
```

- [ ] **Step 2: Write failing team cleanup and compaction tests**

Cover:

- `killPane("t_worker")` closes only worker pane and coordinator remains alive.
- Closing an earlier pane compacts ids; restored operations on a stale coordinate refuse to steer mismatched panes.
- `killTeamSession("tm_1")` closes the team workspace and all member tasks become not alive.

- [ ] **Step 3: Run backend tests and verify RED**

```sh
bun test packages/adapters/__tests__/herdr-backend.test.ts
```

- [ ] **Step 4: Implement team workspace support**

Add internal team workspace map:

```ts
teamWorkspaces: Map<string, { session: string; workspaceId: string; tabId: string; seedPaneId: string }>
```

Behavior:

- first team member creates workspace labelled `team <team_id>`;
- first member uses root pane;
- later members split from a currently live seed pane;
- update seed pane when panes close/compact if fake/runner returns a new current pane;
- `killPane` for team members closes only that pane;
- `killTeamSession` closes workspace idempotently.

- [ ] **Step 5: Verify tests GREEN**

```sh
bun test packages/adapters/__tests__/herdr-backend.test.ts packages/adapters/__tests__/herdr-runner.test.ts
bun run typecheck
```

- [ ] **Step 6: Update docs**

Update docs with actual team behavior and explicit limitation that role tabs are not implemented yet.

- [ ] **Step 7: Run final checks**

```sh
bun test
bun run typecheck
bun run check
```

- [ ] **Step 8: Commit**

```sh
git add packages/adapters/src/herdr-backend.ts packages/adapters/src/testing.ts packages/adapters/__tests__/herdr-backend.test.ts docs/guides/multiplexer-backends.md docs/designs/cuekit-herdr-multiplexer-backend-design.md
git commit -m "feat: add herdr team workspace support"
```

---

## Validation Matrix

Before considering the Herdr backend shippable:

```sh
bun test packages/adapters/__tests__/herdr-coordinate.test.ts \
  packages/adapters/__tests__/herdr-runner.test.ts \
  packages/adapters/__tests__/herdr-backend.test.ts \
  packages/adapters/__tests__/build-multiplexer.test.ts \
  packages/project-config/__tests__/schema.test.ts \
  packages/cli/__tests__/doctor.test.ts
bun run typecheck
bun run check
```

Optional real runtime:

```sh
CUEKIT_HERDR_INTEG=1 bun test packages/adapters/__tests__/herdr-backend-integ.test.ts
```

Full final gate:

```sh
bun test
bun run typecheck
bun run check
```
