# cuekit Guides

Operator and developer guides for shipped cuekit features. These complement the design notes in [`../designs/`](../designs/README.md) — guides describe **how to use** a feature; designs describe **why it works that way**.

## Available guides

- [`agent-profiles.md`](agent-profiles.md) — role-based task submission, profile resolution order, `role: "auto"` selection. Pairs with [agent profiles design](../designs/cuekit-agent-profiles-design.md).
- [`project-config.md`](project-config.md) — `.cuekit.yaml` identity, defaults, scopes, and safety rules. Pairs with [project config design](../designs/cuekit-project-config-design.md).
- [`jcode-adapter.md`](jcode-adapter.md) — manual smoke test for the `jcode repl` adapter (submit, attach, steer, transcript capture, cleanup). Pairs with [jcode adapter design](../designs/cuekit-jcode-repl-adapter-design.md).
- [`gemini-adapter.md`](gemini-adapter.md) — manual smoke test for the Gemini CLI adapter covering interactive + batch modes, `--skip-trust` always-on, `-y` default, and steering via `tmux send-keys`. Pairs with [gemini adapter design](../designs/cuekit-gemini-adapter-design.md).

## When to add a guide

Add a guide here when a feature has shipped and operators or developers need a concise how-to. Keep design rationale in `../designs/` and link from the guide. If a feature is still being investigated or has unresolved questions, write it up in [`../issues/`](../issues/README.md) first.
