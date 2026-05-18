# 004: リリース時のバージョンbump戦略

## 問題

`cuekit --version` が `0.0.11` のままになっていた（実際は `0.0.12` をリリース済み）。

## 原因

`cuekit --version` の表示フロー：
1. `packages/cli/src/bin.ts` → `@cuekit/mcp` を import
2. `packages/mcp/src/cli.ts` → `import pkg from "../package.json"`
3. `pkg.version`（= `packages/mcp/package.json` の version）を表示

つまり **bundle に埋め込まれる version のソースは `packages/mcp/package.json`** である。
リリース時に `packages/cli/package.json` のみを bump し、`packages/mcp/package.json` を更新し忘れたため、表示が古いままになった。

## 対応

リリース時は以下 3 つの `package.json` を必ず同じバージョンにする：

| ファイル | 用途 |
|---|---|
| `packages/cli/package.json` | npm publish されるパッケージ名・バージョン |
| `packages/mcp/package.json` | `cuekit --version` の表示ソース |
| `packages/tui/package.json` | TUI ヘッダーのバージョン表示 |

他の workspace パッケージ（`core`, `store`, `adapters` など）は `workspace:*` のままで問題ない（bundle に直接埋め込まれるため）。ただし開発上の混乱を避けるため、揃えておくのが無難。

## リリース手順（最小限）

```bash
# 1. 3つの package.json を更新
sed -i '' 's/"version": ".*"/"version": "0.0.X"/' packages/cli/package.json
sed -i '' 's/"version": ".*"/"version": "0.0.X"/' packages/mcp/package.json
sed -i '' 's/"version": ".*"/"version": "0.0.X"/' packages/tui/package.json

# 2. bundle 再生成
bun run bundle
cp bin/cuekit.js packages/cli/bin/cuekit.js

# 3. 検証
bun run release:check
bun packages/cli/src/bin.ts --version  # 必ず確認

# 4. commit → push → tag → npm publish
```

## 関連ファイル

- `packages/mcp/src/cli.ts` — version 読み込み元
- `scripts/release-check.ts` — bundle 同期チェック
- `.pi/skills/cuekit-release/SKILL.md` — 完全なリリース手順
