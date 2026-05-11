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
- **TUI の transcript pane は live pane が一次ソース**: running task で owning backend の pane が読めれば現在画面を表示。terminal / capture 失敗時は永続 transcript file に fallback。永続ファイル自体は postmortem 用にそのまま残る。 → [TUI live-pane transcript](docs/designs/cuekit-tui-live-pane-transcript-design.md)
- **PR 周辺の安全側操作**: PR 作成 / マージ / 同期 / クリーンアップは builtin `pr-finisher` profile と `position: finisher` strategy slot で行う。コーディネータ通知のルーティングもこの slot に乗せる。 → [pr-finisher](docs/designs/cuekit-pr-finisher-profile-design.md) / [coordinator notifications routing](docs/designs/cuekit-coordinator-notifications-routing-design.md)
- **Multiplexer は tmux 既定 / zellij 任意**: `.cuekit.yaml` の `multiplexer.backend: zellij` で zellij ≥ 0.43 に切り替え可能。zellij が無いと `logger.warn` を出して tmux にソフトフォールバック (`multiplexer.strict: true` でハードフェイル)。solo zellij task は 0.43 互換の初期 layout pane を使う。team dashboard は zellij **≥ 0.44.2** 前提で、`new-pane` が返す `terminal_N` と pane-targeted `write/dump/rename/close` を使う。zellij session 名は Unix socket path 上限を避けるため solo `ct-<task_id>` / team `ctm-<team_id_suffix>` に短縮する。backend 切替時は `native_task_ref` の backend kind を正とし、attach は維持するが steer/cancel/cleanup は owning backend 以外では抑制する。 → [design](docs/designs/cuekit-multiplexer-backend-design.md) / [ADR 003](docs/decisions/003-zellij-detached-layout.md) / [guide](docs/guides/multiplexer-backends.md)
- **Parent session は通常タスク**: `run_kind: "parent_session"` と `long_lived: true` は `submit_task` の `metadata` フィールドで渡す意味論ラベルで、セッション API や別テーブルは存在しない。TUI の Parent Sessions ビューはこれらのフィールドでフィルタするだけ。長期実行を意図するなら `timeout_ms: null` を必ず渡すこと (プロジェクト既定タイムアウトでキャンセルされないよう)。 → [parent session design](docs/designs/cuekit-parent-session-task-design.md) / [guide](docs/guides/parent-session-tasks.md)
- **Typed handoff は注入成功後にのみ記録**: `steer_task` の `event_type: "handoff"` は adapter の steer が成功した後にのみ artifact と `task_events` レコードを書く。steer が失敗した場合は artifact もイベントも残らない。`actor` / `source` フィールドは意図的に非サポート — provenance は handoff 本文に書くこと。`get_task_snapshot` の `latest_handoffs` で確認できる。 → [guide](docs/guides/parent-session-tasks.md)
- **`get_task_snapshot` は介入前の推奨読み込みパス**: steer や HANDOFF 送信前に `get_task_snapshot` を呼ぶことで、recent events・handoff 一覧・transcript tail を一括取得できる。`get_task_status` より詳細で、coordinator がタスク状態を盲目的に steer するリスクを減らす。 → [MCP API spec §10.6](docs/specs/2026-04-23-cuekit-mcp-api-spec.md)

## パッケージ境界 (実装時に必ず確認)

- `@cuekit/core` — プロトコル型 / Zod schema / lifecycle ヘルパ。**runtime 依存禁止**。
- `@cuekit/store` — SQLite 永続化 (`~/.cuekit/state.db`)、マイグレーション、行デコード。
- `@cuekit/adapters` — ランタイムバインディング (`MultiplexerBackend` + tmux/zellij 実装 + claude-code / pi / opencode / `jcode repl` / gemini)。
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
