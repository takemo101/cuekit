# 005: npm publish 運用と Trusted Publishing の制約

## 問題

npm registry への publish 自動化（Trusted Publishing / OIDC）を試行したが、初回 publish で複数の認証エラーが発生した。

## 経緯

### 1. 手動 publish（0.0.12〜0.0.14）

`npm publish --access public --otp <6桁>` で手動 publish。2FA（パスキー）が有効だったため、毎回 OTP が必要。

### 2. Trusted Publishing 設定

GitHub Actions ワークフローに `id-token: write` を追加し、npm Web UI で Trusted Publisher（GitHub Actions / takemo101/cuekit / publish.yml）を登録。

### 3. エラーの連鎖

| エラー | 原因 |
|---|---|
| `403 - Two-factor authentication is required` | npm アカウントレベルで 2FA が有効 |
| `403 - automation token was specified` | パッケージレベルで「2FA or disallow tokens」が有効 |
| `404 - Not Found` | Trusted Publishing の OIDC トークンは**既存パッケージの更新のみ**対応。初回 publish は不可 |

### 4. 最終的な解決

- npm アカウントの「Require two-factor authentication for write actions」を **disabled**
- パッケージレベルの「Publishing access」を「Require two-factor authentication or a granular access token with bypass 2fa enabled」に設定
- **初回（0.0.15）は手動で `--otp` を入力して publish**
- その後の更新（0.0.16 以降）は Trusted Publishing で自動化

## 決定

### リリース手順（確定版）

```
1. bump version (cli + mcp + tui の 3 package.json)
2. bun run bundle && cp bin/cuekit.js packages/cli/bin/cuekit.js
3. bun test && bun run typecheck && bun run release:check
4. git commit && git push origin main
5. git tag vX.Y.Z && git push origin vX.Y.Z
   → GitHub Actions が Trusted Publishing で自動 npm publish
```

### 重要な制約

- **Trusted Publishing (OIDC) は「既存パッケージの更新」にのみ有効**
- **初回 publish（パッケージが npm に未登録の状態）は手動が必須**
- この制約は npm の仕様であり、ワークフローや設定では回避できない

### npm CLI のバージョン要件 (v0.0.16 で判明)

- **workflow が使う npm は `>= 11.5.1` でなければならない**。`--provenance` 署名は npm 9.5+ で動くが、**publish 自体を OIDC で認証する機能は npm 11.5.1 以降のみ**。それ未満では `NODE_AUTH_TOKEN` への fallback が発動し、token が無いため `PUT https://registry.npmjs.org/<pkg>` が **404** を返す (npm の意図的な「あなたには見えない」レスポンス)。
- `actions/setup-node@v4` を `node-version` 無指定で使うと現状の `ubuntu-latest` ランナーで Node 20 / npm 10.8.2 が選ばれて条件を満たさない。
- 対策: `node-version: '24'` を pin した上で `npm install -g npm@latest` を必ず走らせる。`publish.yml` がこれを実装している。

### パッケージレベル "Publishing access" の drift 注意

- npm Web UI の `https://www.npmjs.com/package/cuekit/access` で **Publishing access** が以下のどちらかになっている必要がある:
  - ✅ `Require two-factor authentication or a granular access token with bypass 2fa enabled` — Trusted Publishing が動く
  - ❌ `Require two-factor authentication and disallow tokens (recommended)` — OIDC トークンも token 扱いで弾かれ、404 になる
- v0.0.15 を手動 publish した直後にこの設定が `recommended` 側に戻ってしまい、v0.0.16 で再露呈した。`disallow tokens` を選んではいけない。Trusted Publisher entry を整えても Publishing access が strict だと publish 不能。

### バージョンbumpの源

`cuekit --version` は `packages/mcp/package.json` の version を読む（`mcp/src/cli.ts` → `incur`）。TUI ヘッダーは `packages/tui/package.json` を読む。npm publish は `packages/cli/package.json` を使う。3 つを必ず揃えること。

## 関連

- [004-version-bump-strategy.md](004-version-bump-strategy.md)
- `.github/workflows/publish.yml` — Trusted Publishing ワークフロー
- `.pi/skills/cuekit-release/SKILL.md` — リリース手順スキル
