# Phase B Roadmap: Early Adopter Acquisition

> **Goal:** Make cuekit the default choice for developers who want multi-agent team coding with any AI CLI.

## Phase A Recap (Swarm-lite Completion)

Phase A は swarm-lite の設計・実装を完成させる。

| # | 項目 | ステータス | リリース |
|---|---|---|---|
| A1 | coordinator attention 修正 (3B) | 設計完了 | v0.0.12 |
| A2 | coordinator prompt + long_lived 自動設定 (1A) | 設計完了 | v0.0.12 |
| A3 | `since_team_sequence` wait 最適化 (1B) | 設計完了 | v0.0.13 |
| A4 | `include_blackboard` steer 時添付 (2B) | 設計完了 | v0.0.13 |

---

## Phase B: Early Adopter Acquisition

### B1. 「cuekit + AI CLI」実戦デモコンテンツ

**目標:** 実際の OSS プロジェクトで cuekit を使ったチーム開発を記録・公開し、"cuekit でここまでできる" を示す。

#### B1-1. 実戦プロジェクト選定

| 候補 | 理由 | 難易度 |
|---|---|---|
| **cuekit 自身の dogfood** | すでに実績あり。team strategy で実装・レビュー・リリースを回せる | 低 |
| **小規模 OSS (CLI ツール等)** | 外部の視聴者にとって身近。機能追加/バグ修正の実例として分かりやすい | 中 |
| **有名 OSS の small issue** | 認知度が高く拡散しやすい。ただし issue 選定に時間がかかる | 高 |

**推奨:** cuekit 自身の dogfood を継続 + 小規模 OSS で追加デモ。

#### B1-2. コンテンツ形式

| 形式 | 工数 | 影響力 | 優先度 |
|---|---|---|---|
| **asciinema 録画 + 解説ブログ** | 4-8h | 中 | 🔴 高 |
| **YouTube 動画 (5-10分)** | 16-24h | 高 | 🟡 中（後回し） |
| **GitHub Discussion / README 事例集** | 2-4h | 低〜中 | 🔴 高 |
| **X/Twitter スレッド** | 1-2h | 中 | 🟡 中 |

**推奨:** asciinema + ブログを最初に作り、反応を見て YouTube を検討。

#### B1-3. デモシナリオ設計

```
シナリオ: "Add OAuth2 login feature"

1. 親エージェントが `cuekit team start --strategy feature` を実行
2. Coordinator (pi) が立ち上がり、worker (claude) × 2 + reviewer (pi) を submit
3. Worker A: OAuth2 client implementation
4. Worker B: Login UI + session management
5. Coordinator が `wait_team(follow_new_tasks)` で進捗監視
6. Worker A が blocker を報告 → `report_team_event(type: "blocker")`
7. Coordinator が `steer_team(include_blackboard: true)` で Worker B に共有
8. 両 worker completed → reviewer 投入
9. Reviewer approved → coordinator が `report_task_event(type: "completed")`
10. `get_team_result` で最終サマリーを確認

→ TUI でこの全プロセスが可視化されていることを示す
```

#### B1-4. 技術的準備

- [ ] 実戦で使える `.cuekit.yaml` テンプレート集を `examples/` に配置
- [ ] `examples/github-issue-to-team/` — issue URL を受け取って team を起動するスクリプト
- [ ] `examples/refactor-loop/` — 大規模リファクタリング用の strategy + team 構成例

---

### B2. jcode swarm 統合デモ

**目標:** "cuekit は swarm の実行基盤になりえる" ことを示す。

#### B2-1. 統合アーキテクチャの設計

```
┌─────────────────────────────────────────┐
│         jcode swarm (scheduler)         │
│  ┌─────────┐  ┌─────────┐  ┌────────┐ │
│  │ planner │→│ worker  │→│reviewer│ │
│  └────┬────┘  └────┬────┘  └───┬────┘ │
│       │            │            │      │
│       └────────────┴────────────┘      │
│                    ↓ submit_task       │
├─────────────────────────────────────────┤
│              cuekit (substrate)         │
│  ┌─────────┐  ┌─────────┐  ┌────────┐ │
│  │ adapter │  │multiplex│  │ events │ │
│  │ (pi/    │  │ (tmux/  │  │(SQLite)│ │
│  │ claude) │  │ zellij) │  │        │ │
│  └─────────┘  └─────────┘  └────────┘ │
│                    ↓ collect_result    │
├─────────────────────────────────────────┤
│         AI CLI (pi / claude / etc)      │
└─────────────────────────────────────────┘
```

#### B2-2. 統合の実装方針

**Option A: jcode swarm から cuekit MCP を呼ぶ**
- jcode swarm の task executor として cuekit MCP server を使う
- jcode swarm は「スケジューリング + エージェント間通信」、cuekit は「spawn + multiplexer + event 永続化」

**Option B: cuekit CLI を jcode swarm の hook から呼ぶ**
- jcode swarm の hook system (pre-task, post-task) から `cuekit submit_task` を呼ぶ
- より軽量だが、双方向通信が制限される

**推奨: Option A (MCP)**
- jcode swarm が coordinator 相当の役割を持ち、cuekit は worker spawn + 監視 + 結果収集を担当
- これにより jcode swarm は「adapter/multiplexer の管理」から解放される

#### B2-3. デモシナリオ

```
1. jcode swarm で "Implement caching layer" の plan を作成
2. Plan は 3 worker tasks を生成
3. jcode swarm が cuekit MCP を通じて `submit_team_tasks` を呼ぶ
4. cuekit が pi/claude/opencode を並列起動
5. jcode swarm が `wait_team` で進捗を監視
6. Worker 間の情報共有は jcode swarm の channel を使用、
   cuekit は各 worker のイベントを永続化
7. 全 worker completed → jcode swarm が review task を submit
8. Review passed → jcode swarm が PR creation task を submit (pr-finisher)
```

#### B2-4. 技術的準備

- [ ] `docs/integrations/jcode-swarm.md` — 統合ガイド
- [ ] `examples/jcode-swarm-integration/` — 最小限の統合例
- [ ] jcode swarm 側の adapter 実装（必要に応じて PR）

---

### B3. Aider からの移行ガイド

**目標:** Aider ユーザー（最も近いターゲット層）を cuekit に移行させる。

#### B3-1. Aider との比較表

| 機能 | Aider | cuekit |
|---|---|---|
| 複数モデル対応 | ✅ | ✅ |
| Git 統合 | ✅ (auto-commit) | ✅ (but skill) |
| マルチファイル編集 | ✅ | ✅ (worker 並列) |
| **マルチエージェント協調** | ❌ | ✅ |
| **イベント永続化** | ❌ | ✅ |
| **TUI 監視** | ❌ | ✅ |
| **MCP 統合** | ❌ | ✅ |
| セットアップ容易さ | 高 | 中 |

#### B3-2. 移行ガイドの構成

```
docs/migrations/aider-to-cuekit.md

1. Aider との概念対応
   - Aider の " architect / editor " → cuekit の " coordinator / worker "
   - Aider の " voice command " → cuekit の " strategy + team "
   - Aider の " auto-commit " → cuekit の " but skill + finisher "

2. コマンド対応表
   - `aider --model gpt-4` → `cuekit submit_task --agent_kind pi --model openai/gpt-4`
   - `aider --edit` → `cuekit team start --strategy refactor`
   - `/add file` → 自動的に task context に含まれる
   - `/commit` → `but commit` (gitbutler skill)

3. 設定ファイル対応
   - `.aider.conf` → `.cuekit.yaml`
   - `AIDER_MODEL` 環境変数 → `.cuekit.yaml` の `submit.model`

4. ユースケース別移行例
   - "单一ファイル編集" → `submit_task` (Aider と同じ感覚)
   - "機能追加" → `team start --strategy feature`
   - "リファクタリング" → `team start --strategy refactor`
```

#### B3-3. 移行の摩擦を減らす機能

| 摩擦 | 解決策 | 優先度 |
|---|---|---|
| `.cuekit.yaml` の作成が面倒 | `cuekit init --from-aider` コマンド | 🟡 中 |
| Aider の「会話モード」がない | coordinator task で「対話的な実装」をサポート | 🔴 高 |
| Aider の自動 git commit | `but` skill を標準搭載し、finisher で自動化 | 🟡 中 |

---

## Phase B の実装優先順位

### Immediate (v0.0.12-0.0.13)
1. **Phase A 実装完了** — swarm-lite 改善をリリース
2. **B1-4: 実戦テンプレート** — `.cuekit.yaml` テンプレート集

### Short-term (v0.0.14)
3. **B3-2: Aider 移行ガイド** — docs/migrations/
4. **B1-2: asciinema + ブログ** — cuekit dogfood の録画・解説

### Medium-term (v0.0.15)
5. **B2-2: jcode swarm 統合設計** — アーキテクチャ文書
6. **B2-4: 統合例** — examples/jcode-swarm-integration/

### Ongoing
7. **B1-1: 実戦プロジェクト** — 継続的に dogfood + 外部 OSS
8. **コミュニティ** — GitHub Discussions, リリースノート充実

---

## 成功指標 (KPI)

| 指標 | 現状 | 3ヶ月後目標 | 6ヶ月後目標 |
|---|---|---|---|
| GitHub Stars | ? | +50 | +200 |
| GitHub Discussions 投稿数 | ? | 10 | 50 |
| `cuekit team start` の外部使用報告 | 0 | 3 | 10 |
| ブログ/動画の総再生・閲覧数 | 0 | 1,000 | 5,000 |
| Aider 移行報告 | 0 | 1 | 5 |

---

## リスクと対策

| リスク | 確率 | 対策 |
|---|---|---|
| 実戦デモが「作為的」に見える | 中 | 実際の issue/PR を使う。編集なしの asciinema |
| jcode swarm 統合が双方向に進まない | 中 | まず設計文書だけ公開。jcode 側の反応を見る |
| Aider ユーザーが移行モチベーションを持たない | 高 | 「Aider ではできないこと」を前面に出す |
| ドキュメントが追いつかない | 高 | コード変更と同時に docs/ を更新するルール化 |
