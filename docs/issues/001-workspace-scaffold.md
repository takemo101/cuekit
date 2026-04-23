# Issue 001: workspace scaffold を作る

## 目的
cuekit の Bun workspace モノレポ土台を作る。

## スコープ
- root `package.json`
- root `tsconfig.json`
- root `biome.json`
- root `bunfig.toml`
- root `.gitignore`
- root `README.md`
- `packages/core`
- `packages/store`
- `packages/adapters`
- `packages/mcp`
の空 package 作成

## 完了条件
- `bun run typecheck` が実行可能な状態になる
- `bun run test` が空でも落ちない状態になる
- `bun run check` が実行可能になる
- package 構成が `docs/architecture/overview.md` に一致する
- `@cuekit/mcp` が `incur` を使う前提の workspace 構成になっている

## 受け入れ条件
- Bun workspace が有効
- TypeScript strict 設定が入っている
- Biome 設定が入っている
- 4 package の `package.json` / `tsconfig.json` がある
- docs へのリンクを root `README.md` に置く

## 依存
- なし

## 実装メモ
- mimicui の root 設定を参考にしてよい
- ただし cuekit の package 名に合わせる
- `type: "module"` を前提にする
- control surface は `incur` 前提なので、依存追加しやすい root scripts / workspace 解決にしておく
