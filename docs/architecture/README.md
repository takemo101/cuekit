# cuekit Architecture Index

This directory defines the architectural rules and development constraints for cuekit.

These documents are not feature specs. They describe **how cuekit must be implemented**.

## Reading Order

1. [`overview.md`](overview.md)
   - package structure
   - dependency direction
   - architectural boundaries
   - implementation order

2. [`design-principles.md`](design-principles.md)
   - protocol-first rules
   - delegation-first mindset
   - runtime opacity
   - capability truthfulness

3. [`coding-rules.md`](coding-rules.md)
   - naming rules
   - file/module structure
   - schema-first style
   - persistence minimalism

4. [`development-workflow.md`](development-workflow.md)
   - build order
   - test-first expectations
   - commit granularity
   - MVP implementation path

5. [`error-handling.md`](error-handling.md)
   - error taxonomy
   - structured error vs throw rules
   - layer-by-layer handling guidance

## Relationship to Specs

See the specs index here: [`../specs/README.md`](../specs/README.md)


The documents under `../specs/` define **what cuekit is**.

The documents under `docs/architecture/` define **how cuekit must be built**.

### Read specs for
- protocol shape
- state model
- MCP API
- adapter expectations
- related work and scope boundaries

### Read architecture docs for
- dependency rules
- naming constraints
- implementation sequence
- persistence constraints
- error handling rules

## Current Architectural Position

cuekit is implemented as a small protocol-and-adapter system, not as a full orchestration platform.

### Core shape
- `@cuekit/core` — pure protocol and schema
- `@cuekit/store` — SQLite persistence
- `@cuekit/adapters` — runtime bindings
- `@cuekit/mcp` — MCP control surface

### v0 focus
- submit delegated work
- observe status
- collect normalized results
- cancel delegated work

### explicitly not v0 focus
- workflow engine
- kanban system
- swarm OS
- memory platform
- heavy remote orchestration infrastructure

## Rule of Thumb

If a design or implementation choice makes cuekit feel like a full coordination platform instead of a delegation substrate, it is probably outside the intended scope of v0.
