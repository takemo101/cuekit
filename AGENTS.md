# cuekit AI Guidelines

エージェントが cuekit リポジトリで作業するときの最初の入口。要点だけ書く。詳細は必ずリンク先を読むこと。

## 入口

- ドキュメント全体図: [docs/README.md](docs/README.md)
- プロトコル / 状態モデル / MCP API / アダプタ契約: [docs/specs/](docs/specs/README.md)
- 実装制約 (パッケージ境界、命名、エラー方針): [docs/architecture/](docs/architecture/README.md)
- 安定した機能設計 (teams、strategies、profiles、adapters、TUI...): [docs/designs/](docs/designs/README.md)
- 操作ガイド: [docs/guides/](docs/guides/README.md)
- TUI / OpenTUI 実装前: [OpenTUI references](docs/references/opentui/README.md) を先に読む

## 守るべき設計方針 (ADR)

- **ADR 001 — Child reporting**: 子エージェントの進捗/完了報告は単一の MCP/CLI `report_task_event` 操作で SQLite `task_events` に保存し、これを正の状態とする。`parent_notifications` / push / ack / transcript marker は具体的必要が出るまで実装しない。 → [ADR 001](docs/decisions/001-child-reporting-surface.md)
- **ADR 002 — Grouped MCP surface**: MCP は AI 向けに grouped tools (`list({kind})`, `steer({kind})`, `delete({kind})` ほか) を公開し、`steer_task` / `steer_team` などのフラット名は互換エイリアスとして残す。`cuekit mcp config` は CLI-only で MCP からは公開しない。 → [ADR 002](docs/decisions/002-grouped-mcp-surface.md)

## v0 スコープの線引き

cuekit は **child-agent delegation substrate** であり、ワークフローエンジンではない。次は v0 スコープ外:

- 自動スケジューリング / auto-wake / auto-steer など、親エージェントの判断を置き換える挙動
- workflow engine、kanban、swarm OS、DAG スケジューリング
- 分散ワーカープール、リモート / マルチテナント認証モデル
- コスト計上、長期メモリ

Teams は関連子タスクの軽量ビュー、Strategies は開発の playbook で、いずれも workflow 制御ではない。

## 実装時に踏みやすい落とし穴

- **アダプタ既定モード**: pane アダプタは interactive が既定。batch タスク (`metadata.adapter_mode: "batch"`) は `supports_steering: false` で、`steer_task` は `steering_unsupported` を返す。 → [adapter run modes](docs/designs/cuekit-adapter-run-modes-design.md)
- **権限 bypass の既定**: `claude-code` はランタイム権限 bypass が既定 (pane が止まらないように)。`opencode` は interactive TUI が既定で、bypass は opt-in な batch/run モードのみ適用。`gemini` は `-y` (yolo) を既定 ON にしつつ、加えて `--skip-trust` を常時付与して trusted-folder gate でも止まらないようにする。 → [adapter permission bypass](docs/designs/cuekit-adapter-permission-bypass-design.md)
- **`.cuekit.yaml` の安全側既定**: `cuekit init` が生成する設定は prompt-safe な adapter 既定を持つ。プロジェクト由来の role/agent 既定は、呼び出し側が明示的に `adapter_options` を渡さない限り常に prompt-safe を強制する。 → [project config](docs/designs/cuekit-project-config-design.md) / [guide](docs/guides/project-config.md)
- **Agent profile の解決順**: project (`<repo>/.cuekit/agents/*.md`) → user (`~/.cuekit/agents/*.md`) → builtin。`role: "auto"` は決定的キーワード選択で、選んだ role と理由を task status に記録する。 → [agent profiles](docs/designs/cuekit-agent-profiles-design.md) / [guide](docs/guides/agent-profiles.md)
- **`wait` は境界付きポーリング**: 1 回の長い MCP リクエストではなく、短い `timeout_ms` で再ポーリングする。タイムアウトは待機をやめるだけで子の作業はキャンセルしない。coordinator-led / strategy-backed なチームでは、待機後に新メンバーが追加されるなら `follow_new_tasks: true`。
- **Team の主結果は `task_events` ベース**: `run_summary` / `get_team_result` は transcript 末尾ではなく `task_events` を主結果源とする。 → [task observability](docs/designs/cuekit-task-observability-design.md) / [team attention items](docs/designs/cuekit-team-attention-items-design.md)
- **TUI の transcript pane は live tmux pane が一次ソース**: running task で tmux session が生きていれば `tmux capture-pane` の現在画面を表示。terminal / capture 失敗時は永続 transcript file に fallback。永続ファイル自体は postmortem 用にそのまま残る。 → [TUI live-pane transcript](docs/designs/cuekit-tui-live-pane-transcript-design.md)
- **PR 周辺の安全側操作**: PR 作成 / マージ / 同期 / クリーンアップは builtin `pr-finisher` profile と `position: finisher` strategy slot で行う。コーディネータ通知のルーティングもこの slot に乗せる。 → [pr-finisher](docs/designs/cuekit-pr-finisher-profile-design.md) / [coordinator notifications routing](docs/designs/cuekit-coordinator-notifications-routing-design.md)

## パッケージ境界 (実装時に必ず確認)

- `@cuekit/core` — プロトコル型 / Zod schema / lifecycle ヘルパ。**runtime 依存禁止**。
- `@cuekit/store` — SQLite 永続化 (`~/.cuekit/state.db`)、マイグレーション、行デコード。
- `@cuekit/adapters` — ランタイムバインディング (tmux pane backend + claude-code / pi / opencode / `jcode repl` / gemini)。
- `@cuekit/agent-profiles` — role 解決 (project → user → builtin)。
- `@cuekit/project-config` — `.cuekit.yaml` loader / validator / defaults。
- `@cuekit/mcp` — MCP サーバと grouped tool projection。
- `@cuekit/cli` — `cuekit` バイナリ、`doctor`、`update`、`mcp config`。 → [human CLI distribution](docs/designs/cuekit-human-cli-distribution-design.md)
- `@cuekit/tui` — OpenTUI ベースの human task cockpit。 → [TUI cockpit](docs/designs/cuekit-tui-task-cockpit-design.md) / [package separation](docs/designs/cuekit-tui-package-separation-design.md)

依存方向と実装順序: [`docs/architecture/overview.md`](docs/architecture/overview.md)。

## 開発ループ

- テストは `FakeTmuxRunner` を使うため既定では `tmux` 不要。実 tmux を要求するのは `@cuekit/adapters` の小さな統合スイートだけで、無ければスキップする。
- 変更後は `bun run typecheck` / `bun run test` / `bun run check` を通す。
- 詳細フロー: [`docs/architecture/development-workflow.md`](docs/architecture/development-workflow.md)
