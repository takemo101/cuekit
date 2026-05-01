## Summary
Set up the initial Bun workspace monorepo for cuekit so implementation can proceed package-by-package with consistent tooling and strict type/lint settings.

## Why
All later work depends on a stable workspace layout, shared TypeScript configuration, and consistent scripts. This issue should create the minimal but complete monorepo scaffold aligned with the architecture docs.

## Scope
Create the workspace root files and empty package shells for:
- `packages/core`
- `packages/store`
- `packages/adapters`
- `packages/mcp`

## Deliverables
### Root files
- `package.json`
- `tsconfig.json`
- `biome.json`
- `bunfig.toml`
- `.gitignore`
- `README.md`

### Package shells
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/store/package.json`
- `packages/store/tsconfig.json`
- `packages/adapters/package.json`
- `packages/adapters/tsconfig.json`
- `packages/mcp/package.json`
- `packages/mcp/tsconfig.json`

## Detailed tasks
- [ ] Create root `package.json`
  - [ ] Set `private: true`
  - [ ] Set `type: "module"`
  - [ ] Add `workspaces: ["packages/*"]`
  - [ ] Add root scripts for `build`, `typecheck`, `test`, `check`, `fix`
- [ ] Create root `tsconfig.json`
  - [ ] Enable strict mode
  - [ ] Enable `noUncheckedIndexedAccess`
  - [ ] Use `moduleResolution: "bundler"`
  - [ ] Keep config reusable by all workspace packages
- [ ] Create root `biome.json`
  - [ ] Match project formatting rules
  - [ ] Cover `packages/*/src/**/*.ts` and tests
- [ ] Create `bunfig.toml`
  - [ ] Configure Bun test defaults
- [ ] Create `.gitignore`
  - [ ] Ignore `node_modules`, build output, SQLite files, and local `.cuekit/`
- [ ] Expand root `README.md`
  - [ ] Brief project description
  - [ ] Package overview
  - [ ] Links to specs and architecture docs
- [ ] Create package manifests and local tsconfigs for all 4 packages
- [ ] Ensure `@cuekit/mcp` is prepared to depend on `incur` later without workspace restructuring
- [ ] Run validation commands
  - [ ] `bun run typecheck`
  - [ ] `bun run test`
  - [ ] `bun run check`

## Acceptance criteria
- Bun workspace resolves all packages
- Root scripts run without structural/config errors
- All four packages exist with valid manifests
- The structure matches `docs/architecture/overview.md`
- The repository is ready for package-by-package implementation

## Out of scope
- Any actual protocol logic
- Any database schema
- Any adapter implementation
- Any real CLI/MCP command definitions

## References
- `docs/architecture/overview.md`
- `docs/architecture/coding-rules.md`
- `docs/plans/2026-04-23-cuekit-implementation-plan.md`
