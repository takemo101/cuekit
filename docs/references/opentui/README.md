# OpenTUI Reference Index

Local copy of OpenTUI reference material for cuekit TUI design and implementation.

Read these before working on `cuekit tui`.

## Reading Order

1. [Getting started](01-getting-started.md)
2. [Renderer](02-renderer.md)
3. [Renderables](03-renderables.md)
4. [Constructs](04-constructs.md)
5. [Layout](05-layout.md)
6. [Keyboard, console, colors](06-keyboard-console-colors.md)
7. [Lifecycle](07-lifecycle.md)
8. [Display components](08-components-display.md)
9. [Input components](09-components-input.md)
10. [Scroll components](10-components-scroll.md)
11. [Code components](11-components-code.md)
12. [Solid bindings](12-bindings-solid.md)
13. [React bindings](13-bindings-react.md)
14. [Reference](14-reference.md)

## cuekit Usage Notes

For the planned human-facing TUI:

- prefer a task cockpit layout: task list, selected task detail, events, transcript tail, and action footer.
- `a` / attach should exit the TUI and run `tmux attach-session`; returning to the TUI is not required for v1.
- keep machine/agent CLI output as TOON; the TUI is a separate human operator surface.
