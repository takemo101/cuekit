# cuekit 作業引継ぎ - Phase B 実装

## 現在の状態（v0.0.15）

- **npm publish済み**: `cuekit@0.0.15`（npm registry）
- **Trusted Publishing**: GitHub Actionsでtag push時に自動publishされる（初回以降）
- **TUI version header**: `packages/tui/src/app.tsx`に`cuekit X.Y.Z — Tasks/Teams/Parent Sessions`を表示
- **version bump戦略**: `packages/cli`, `packages/mcp`, `packages/tui`の3つのpackage.jsonを必ず揃えること（ADR 004, 005参照）

## 次のタスク（A → B → C → D）

### A. VitePressドキュメント整備

- **公式ドキュメントサイトの構築**
- `docs/`配下をVitePress化し、GitHub Pagesでホスティング
- 必要なページ:
  - Quickstart（5分で始めるチュートリアル）
  - APIリファレンス（MCP tool一覧と例）
  - インストールガイド（npm, GitHub, Homebrew）
  - Team Strategyの使い方
  - Agent Profileの使い方

**技術的ヒント**:
```bash
# VitePressのセットアップ
npm add -D vitepress
npx vitepress init
# docs/.vitepress/config.ts を設定
# GitHub Actionsでpagesデプロイ
```

### B. ランディングページ

- **プロジェクト紹介ページ**（GitHub Pages or Vercel）
- 含めるべき内容:
  - cuekitのコンセプト（"child-agent delegation substrate"）
  - スクリーンショット / TUIの画像
  - インストールコマンド（`npm install -g cuekit`）
  - 主要機能の紹介（Teams, Strategies, MCP, TUI）
  - "cuekit vs 他ツール"の比較表
  - GitHubリポジトリへのリンク

**技術的ヒント**:
- VitePressのトップページとして実装するか、別途静的サイトジェネレータ（Astro等）を検討
- `.github/workflows/pages.yml`でGitHub Pagesへデプロイ

### C. 技術的改善

1. **`include_blackboard`の実用化**
   - `packages/mcp/src/commands/steer-team.ts`に実装済み
   - coordinator prompt（`packages/mcp/src/team-strategy.ts`）で`include_blackboard: true`を推奨するように誘導

2. **TUI headerのバージョン表示確認**
   - `packages/tui/src/app.tsx`に実装済み
   - 実際に`cuekit tui`を起動して`cuekit 0.0.15 — Tasks`が表示されるか確認

3. **テストカバレッジ向上**
   - `since_team_sequence`のエッジケース（空チーム、pre-migration null team_sequence）
   - `follow_new_tasks`との組み合わせ

### D. 既知の問題対応

1. **Trusted Publishingの自動化確認**
   - v0.0.16で`git tag v0.0.16 && git push origin v0.0.16`だけで自動publishされるか検証
   - `.github/workflows/publish.yml`は設定済み

2. **claude-code reviewerのinteractive mode stall**
   - read-onlyタスクにはbatch mode（`-p` flag）が適切
   - `packages/adapters/src/claude-code-adapter.ts`のdefault modeを見直し

## 実装順序の推奨

```
1. A: VitePressセットアップ → Quickstart作成 → GitHub Pagesデプロイ
2. B: ランディングページ（VitePressトップページとして実装）
3. C: include_blackboardのcoordinator誘導 + TUI動作確認 + テスト追加
4. D: v0.0.16の自動publish確認 + claude-code batch mode改善
```

## 重要な注意点

- **バージョンbump**: リリース時は必ず`packages/cli`, `packages/mcp`, `packages/tui`の3つを同じバージョンにすること
- **bundle**: `bun run bundle`後に`bin/cuekit.js`を`packages/cli/bin/cuekit.js`にコピーすること
- **Biome**: 変更後は必ず`bun run check`/`bun run fix`を通すこと
- **ADR**: 重要な決定は`docs/decisions/`に記録すること
- **SKILL**: `.pi/skills/`の更新も忘れずに

## 参照ファイル

- ADR 004: `docs/decisions/004-version-bump-strategy.md`
- ADR 005: `docs/decisions/005-npm-publish-operations.md`
- Release SKILL: `.pi/skills/cuekit-release/SKILL.md`
- 製品化計画: `docs/plans/2026-05-16-productization-foundation.md`
- Phase B Roadmap: `docs/plans/2026-05-16-phase-b-roadmap.md`

## ブランチ戦略

```
feat/vitepress-docs          # A
feat/landing-page            # B（Aに依存する場合はAマージ後）
feat/include-blackboard-prompt # C
test/since-team-sequence-edge  # C（続き）
fix/claude-code-batch-mode   # D
```

各ブランチは独立してPR作成可能。Aが先にマージされると、BはAにrebaseして進める。
