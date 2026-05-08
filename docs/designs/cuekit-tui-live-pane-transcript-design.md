# Design: TUI live-pane transcript

## Problem

cuekit's TUI task-detail panel rendered a "TRANSCRIPT TAIL" view by reading the persisted file at `<cwd>/.cuekit/tasks/<id>/transcript.txt`, tail-stripping ANSI to plain text, and slicing to ~80 lines. That file is the raw byte stream that `tmux pipe-pane` writes — for **frequently-redrawing TUI children** (Gemini CLI, opencode TUI, ...) it accumulates cursor-move and clear escapes plus repeated UI chrome rather than conversation content. The tail-cap then evicts the actual response off the bottom edge while keeping a sequence of redraw frames.

For Gemini in particular, operators saw the panel showing only a repeating frame border and an empty input prompt — no haiku, no code, no diff. Attaching with `tmux attach-session` produced the right view, so the problem was specifically the TUI's data source, not the child's behaviour.

This was the immediate user-visible motivation. A nearby UX complaint — "scrolling up resets to bottom on every refresh" — emerged once the live source landed and is addressed in [#377](#related-decisions).

## Decision

For **non-terminal tasks with a known tmux session**, source the TUI transcript panel from `tmux capture-pane -p -J -S -<N> -t <session>` (the *current rendered screen*) instead of the persisted file. For terminal tasks, unknown sessions, capture failures, or empty captures, fall back to `readTranscriptTail` (the existing file-tail path). The persisted transcript file remains the canonical postmortem source — only the live observation path moves.

The decision discriminator returns to the renderer so the panel header can spell out the source as `LIVE OUTPUT (N lines, tmux pane)` vs `LIVE OUTPUT (N lines, transcript file)`. Operators see at a glance whether the panel content matches what `tmux attach` would show.

### Why not parse the file better

The persisted file is a stream of bytes. To get "the current screen" out of it we'd have to implement a terminal emulator (cursor position, scroll region, character-cell grid) just to apply the redraws. That's exactly what tmux already does inside its server process. `tmux capture-pane` is the cheapest correct answer.

### Why not just `tmux attach` for everything

Attach is interactive — it grabs the session and prevents simultaneous viewers. The TUI is a multi-task cockpit; switching task selection should not dismount the previous task's pane. capture-pane is read-only and concurrent.

## Non-goals (deliberately deferred)

| Non-goal | Rationale |
|---|---|
| Color preservation in the rendered panel | OpenTUI's `<text>` takes plain strings or `StyledText`. Translating ANSI SGR escapes into `StyledText` chunks is a separate ANSI parser plus chunk-aware truncation/padding effort. Filed as a follow-up. |
| Per-task auto-refresh cadence tuning | The existing TUI auto-refresh interval (now async-safe) carries the live-pane fetch. Tuning the cadence (faster while a task is running, paused while user scrolled away) is a separate UX concern. |
| Replacing the persisted transcript file | The file remains the postmortem source. A child agent that finishes overnight is observed via `cuekit task result` and the file, not capture-pane. |
| `cuekit task watch <id>` CLI | A standalone "live tail without TUI" was prototyped and discarded once the TUI integration shipped. AI agents should use MCP grouped tools (`get_status` / `wait` / `list events` / `get_task_result`) for structured information; humans use `cuekit tui`. Reconsider only if a real script-piping use case appears. |

## Implementation outline

`packages/tui/src/data.ts`:

- `captureLivePaneTail(sessionName, maxLines, opts) → Promise<string[] | null>`
  - Async via `Bun.spawn` so the auto-refresh loop never blocks the TUI event loop on a slow tmux server.
  - Drops trailing blank lines tmux uses to fill the viewport; returns `null` if the resulting tail is empty so the caller can fall back to the file.
  - Does **not** apply `isLowValueTranscriptLine` (that filter was tuned for the file-tail path; capture-pane is post-render content the user is staring at, dropping lines from it would hide content).
- `resolveTranscriptTail(status, transcriptPath, maxLines) → Promise<{ lines, source }>`
  - Returns `source: "live"` when capture-pane succeeded, `source: "file"` otherwise. The source flows into `TuiTaskDetail.transcriptSource`.

`packages/tui/src/components/task-detail.tsx`:

- Pads the LIVE OUTPUT lines with empty strings at the head to a stable target height (`DEFAULT_TRANSCRIPT_LINES` from `data.ts`) before they reach the OpenTUI scrollbox. Stable height keeps the user's scroll offset valid across refreshes; sticky-bottom places newest content at the visual edge. See [#377](#related-decisions).
- LIVE OUTPUT header surfaces the `transcriptSource` discriminator.

`packages/cli/src/bin.ts`:

- `buildTuiAdapterRegistry(db, panes, opts)` factory used by `runTuiCommand`. Exported so the regression test can drive it directly and assert the registered adapter set without string-greps.

## Observability and operator feedback

`cuekit doctor` now probes `tmux capture-pane` against a guaranteed-missing target and treats `"can't find session"` (or exit 0) as success. Subcommand-not-recognised paths surface as a warn-level row. Without this probe, an ancient or hand-stripped tmux build would silently break the new TUI live preview.

## Trade-offs and open risks

- **Capture-pane is "current screen", not "history".** A child that produced a long response and then scrolled it past the visible region will not show the response in the panel even though it was visible at the time. The persisted file still has the bytes; user must open it for backread. This is intrinsic to the data source, not a bug.
- **Padding produces visual blank space for short outputs.** A 5-line response renders as 75 empty lines + 5 content lines. Sticky-bottom hides this on landing; users who scroll up see the empty region. Acceptable trade-off for stable scroll position; revisit if real complaints arrive.
- **Width drift between tmux pane and TUI viewport.** `tmux capture-pane` returns text at the pane's own column width. The TUI panel may be narrower; the existing `truncateEnd(line, 150)` clip handles overflow but doesn't reflow.

## Related decisions

- **#376** — initial replacement of file-tail with capture-pane in the TUI panel.
- **#377** — pad LIVE OUTPUT to a stable height so scrollbox sticky-scroll's "pause on user scroll" works as designed.
- **#378** — async tmux spawn, empty-stdout fallback, file-tail noise filter scoped to the file path only, padding constant consolidation.
- **#379** — `transcriptSource` indicator in the TUI header + doctor capture-pane probe.
- **#380** — drive the registry regression test from the actual factory rather than a string-grep.

## When to revisit

- If a user reports being unable to see specific past content in the LIVE OUTPUT panel (capture-pane "current screen" limitation): consider a hybrid view that surfaces both the live capture and the file-tail.
- If the TUI feels laggy under heavy task counts: profile the per-refresh tmux spawn cost; consider caching, or moving to `tmux refresh-client`-driven event updates.
- If color preservation becomes a real ask: revive the deferred ANSI → `StyledText` work and switch capture-pane invocation to `-e`.
