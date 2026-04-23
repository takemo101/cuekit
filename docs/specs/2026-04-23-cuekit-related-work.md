# cuekit Related Work and Implementation References

> Use together with the architecture index at [`../architecture/README.md`](../architecture/README.md) to keep implementation scope disciplined.

> External protocols and projects that inform cuekit's design and implementation boundaries.

## 1. Purpose

This document captures external references that are useful when designing or implementing cuekit.

These references do **not** define cuekit. Instead, they help clarify:

- what cuekit is similar to
- what cuekit should deliberately avoid becoming
- which implementation patterns are worth borrowing

---

## 2. Summary

The current view of cuekit is:

- **conceptually close to A2A** in that it focuses on agent-to-agent delegation
- **practically MCP-facing** in that existing coding agents can consume it via MCP tools
- **much smaller in scope than orchestration platforms like hive-mcp**

cuekit should be treated as a lightweight delegation substrate for coding agents, not as a full multi-agent operating environment.

---

## 3. A2A (Agent2Agent)

### Why it matters

A2A is the closest conceptual match to cuekit among the surveyed standards.

A2A focuses on:

- agent discovery
- capability discovery
- task delegation
- long-running task lifecycle
- result return
- opaque interoperability between agents

This aligns with cuekit's main concern: one agent or controller delegating work to another agent and retrieving a useful result.

### What cuekit should borrow

- the idea that agents are peers, not just tools
- long-running task lifecycle thinking
- capability discovery as an explicit concern
- separation between public interoperability and private internal implementation

### What cuekit should not copy directly

- full generic remote-agent interoperability scope
- broad modality negotiation requirements
- enterprise-scale federated assumptions
- complex general-purpose agent discovery if cuekit stays local/developer-focused in v0

### Conclusion

A2A is best treated as a **conceptual reference** and possibly a future compatibility target, but not a constraint on cuekit v0.

---

## 4. MCP and A2A-MCP Bridges

### Why they matter

Multiple projects bridge MCP clients to A2A agents. This validates an important design assumption for cuekit:

> A protocol can be agent-to-agent at its core while still being exposed through MCP as a practical control surface.

Examples observed during research include:

- A2A-MCP connector work in the A2A ecosystem
- `a2a_mcp_bridge`
- `mcp-a2a-gateway`

These systems generally expose MCP tools such as:

- registering agents
n- listing agents
- sending a task or message
- retrieving task results
- cancelling tasks

### What cuekit should borrow

- MCP as a practical bridge for existing coding agents
- tool-level task lifecycle operations
- structured task/result management through a small tool surface

### What cuekit should avoid

- assuming that MCP defines the core semantics
- coupling the core protocol too tightly to bridge-specific details
- overfitting to generic A2A gateway concerns before cuekit's own local delegation model is stable

### Conclusion

These bridges strongly support cuekit's **MCP-facing surface**, while reinforcing that the underlying semantics are closer to agent delegation than to tool invocation.

---

## 5. hive-mcp

### Why it matters

`hive-mcp` is a valuable implementation reference because it shows how MCP can front a richer multi-agent system.

From the surveyed materials, hive-mcp includes:

- MCP control surfaces for coordination
- explicit multi-agent roles (planners, drones, workers)
- wave dispatch and coordination
- session continuity and memory
- knowledge graph and broader workflow support

### Why it is relevant to cuekit

hive-mcp demonstrates useful implementation patterns for:

- exposing coordination operations through MCP
- designing tool namespaces for agent coordination
- thinking about adapters, bridges, and extensibility
- separating a user-facing agent control surface from underlying coordination machinery

### What cuekit should borrow

- MCP tool surface design patterns
- bridge/addon architecture thinking
- a clear separation between control surface and coordination internals
- practical patterns for dispatching work to workers and collecting outputs

### What cuekit should explicitly not become

cuekit should **not** absorb hive-mcp's broader platform scope in v0.

That means cuekit should avoid becoming a bundled platform for:

- project memory
- knowledge graphs
- kanban/task boards
- workflow engines
- swarm operating environments
- long-lived session continuity systems

Those may be valid systems that *use* cuekit, but they should not define cuekit itself.

### Conclusion

hive-mcp should be treated as an **implementation reference**, especially for MCP surface design and coordination tooling, but it sits at a higher abstraction level than cuekit.

---

## 6. ACP (Agent Client Protocol)

### Why it matters

ACP is useful as a runtime/session control concept, especially when a coding agent exposes session lifecycle and streaming updates through a standard client-agent protocol.

### Relevance to cuekit

ACP is not the best conceptual center for cuekit because ACP is oriented around:

- client ↔ agent interaction
- prompt turns
- session lifecycle in editor-like environments

cuekit is more about:

- task delegation
- result normalization
- adapter-based cross-runtime orchestration

### What cuekit should borrow

- session lifecycle control ideas where useful
- cancellation and update-stream thinking for adapters that happen to use ACP internally

### What cuekit should avoid

- making ACP a required dependency
- shaping cuekit's core around client/editor semantics

### Conclusion

ACP is an **optional implementation backend reference** for adapters, not a defining abstraction for cuekit.

---

## 7. Implications for cuekit Design

The reviewed work suggests these design conclusions.

### 7.1 cuekit should stay small

cuekit should remain a lightweight delegation substrate centered on:

- task submission
- status observation
- result collection
- cancellation
- optional steering

### 7.2 cuekit should stay protocol-first

The stable core is:

- task/task model
- adapter contract
- normalized result model
- error model

### 7.3 cuekit should keep MCP as a reference surface

MCP remains the most practical way for existing coding agents to consume cuekit in real workflows.

### 7.4 cuekit should remain compatible with richer futures

The design should leave room for:

- richer capability discovery
- richer progress semantics
- optional steering extensions
- eventual alignment with A2A-like interoperability patterns

But those should not expand v0 prematurely.

---

## 8. Working Design Position

A concise positioning statement for cuekit:

> cuekit is a lightweight task delegation and result-normalization layer for coding agents. It is conceptually closer to A2A than to MCP, uses MCP as a practical control surface, and should remain much smaller in scope than full multi-agent coordination platforms such as hive-mcp.

---

## 9. Practical Guidance for Implementation

When implementing cuekit, use these references in this order:

1. **Own protocol spec first** — do not let external projects distort the core unnecessarily.
2. **A2A for conceptual sanity checks** — especially task lifecycle and peer-agent thinking.
3. **MCP-A2A bridges for tool surface ideas** — especially small tool sets and bridging patterns.
4. **hive-mcp for practical coordination surface ideas** — especially naming, grouping, and bridge boundaries.
5. **ACP only when useful inside a specific adapter**.

---

## 10. Recommendation

Keep this document as a living reference while implementation begins.

If cuekit grows in scope, this document should be revisited to ensure the project remains intentionally narrow and does not drift into becoming a full orchestration platform before the delegation substrate is solid.
