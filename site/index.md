---
layout: home

hero:
  name: cuekit
  text: Child-agent delegation for coding agents
  tagline: A stable substrate to spawn, observe, steer, and clean up coding sub-agents — from a parent agent, CLI, or MCP client.
  actions:
    - theme: brand
      text: Get Started
      link: /quickstart
    - theme: alt
      text: Install
      link: /install
    - theme: alt
      text: View on GitHub
      link: https://github.com/takemo101/cuekit

features:
  - icon: 🧩
    title: Delegation substrate, not a workflow engine
    details: The parent agent stays the decision-maker. cuekit makes child tasks observable, steerable, and persistent — without auto-scheduling or hidden control flow.
  - icon: 👀
    title: Live attach via tmux / zellij / herdr
    details: Every child task runs in a real multiplexer pane. Attach with one keystroke from the TUI, capture transcripts, or read the live screen from anywhere.
  - icon: 🛠️
    title: Grouped MCP + human CLI
    details: The same surface is exposed twice — `cuekit task ...` for humans and `list / steer / delete / submit_task / wait` grouped MCP tools for AI callers.
  - icon: 🎯
    title: Strategies and Profiles
    details: Project-local Team Strategies frame the mission and recommended team. Agent Profiles encode role instructions so submit calls stay short.
  - icon: 🔌
    title: Adapters for real coding agents
    details: Built-in adapters for claude-code, opencode, jcode REPL, gemini, and pi. Mix interactive and batch modes per task.
  - icon: 💾
    title: Durable state via SQLite
    details: Tasks, teams, events, and handoffs persist to `~/.cuekit/state.db`. Transcripts and artifacts live under `<repo>/.cuekit/tasks/<task_id>/`.
---
