# Issue 005: MCP control surface を実装する

## 目的
cuekit の v0 reference control surface を MCP として公開する。

## スコープ
`packages/mcp` に以下の tools を実装する。

- `submit_task`
- `get_task_status`
- `get_task_result`
- `cancel_task`
- `list_tasks`
- `list_adapters`
- `steer_task` は optional / experimental

## 完了条件
- MCP server が起動する
- required 6 tools が利用可能
- tools が core/store/adapters を接続する

## 受け入れ条件
- request/response shape が `docs/specs/2026-04-23-cuekit-mcp-api-spec.md` に一致する
- malformed tool input は tool error
- invalid protocol state は structured error payload
- `list_adapters` で capability discovery ができる
- steering unsupported を正しく返せる

## 依存
- Issue 002
- Issue 003
- Issue 004

## 実装メモ
- MCP は orchestration brain にしない
- runtime-specific branching を handler に持ち込まない
- delegation-first を守る
