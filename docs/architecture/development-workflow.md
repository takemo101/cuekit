# cuekit 開発ワークフロー

> See [`../specs/README.md`](../specs/README.md) for the design and protocol documents this workflow implements.

## 開発順序

cuekit の実装順序は以下を厳守する。

```text
Core → Store → Adapters → MCP
```

理由:

1. protocol が先に固まらないと persistence も adapter も安定しない
2. state model が無いと adapter の task/session 追跡が曖昧になる
3. MCP は最後に被せる control surface だから

---

## フェーズ1: Core を test-first で実装

対象:
- task/session types
- status enums
- error types
- Zod schemas
- state transition helpers
- capability shapes

### 例

```ts
describe("ensureCollectable", () => {
  it("allows completed tasks", () => {
    expect(ensureCollectable("completed")).toEqual({ ok: true });
  });

  it("rejects running tasks", () => {
    expect(ensureCollectable("running")).toEqual({
      ok: false,
      error: { code: "invalid_state", message: expect.any(String) },
    });
  });
});
```

Core は外部依存なしで終わらせる。

---

## フェーズ2: Store を実装

対象:
- SQLite schema
- migrations
- session CRUD
- task CRUD
- query helpers
- row decode / encode

### ルール
- DB row は core schema に寄せて decode する
- `~/.cuekit/state.db` と `<worktree>/.cuekit/` の責務を分ける
- file content は DB に埋め込まない

### テスト
- session insert/load
- task insert/update/list
- worktree単位で active session を引けること
- task result_ref / transcript_ref を保持できること

---

## フェーズ3: Adapters を実装

対象:
- `PiAdapter`
- `ClaudeCodeAdapter`
- `OpenCodeAdapter`

### 実装順
最初は 1 本だけ spike する。

推奨:
1. 一番 controllable な adapter
2. submit/status/collect/cancel が通る最小 path
3. steering は optional

### ルール
- adapter は runtime-native state を cuekit state に翻訳する
- runtime-specific metadata は `metadata` に閉じ込める
- generic orchestrator は adapter 固有挙動を前提にしない

### テスト
- submit で stable id が返る
- status が cuekit enum に落ちる
- collect が normalized result を返す
- cancel が structured ack を返す

---

## フェーズ4: MCP surface を実装

対象ツール:
- `submit_task`
- `get_task_status`
- `get_task_result`
- `cancel_task`
- `list_tasks`
- `list_adapters`
- `steer_task` は optional / experimental

### ルール
- MCP は orchestration brain ではない
- MCP は protocol の control surface に徹する
- tool handlers に runtime-specific logic を持ち込まない

### テスト
- valid input -> valid structured output
- invalid input -> MCP/tool error
- invalid protocol state -> structured error payload
- adapter capability が正しく surface に出る

---

## 依存方向

```text
mcp → core
mcp → store
mcp → adapters

store → core
adapters → core
```

禁止:

```text
❌ core → store
❌ core → adapters
❌ store → adapters
❌ adapters → mcp
```

---

## 実装単位

1つの変更で抱え込みすぎない。

### 良い単位
- core の status enum + schema
- store の sessions repository
- one adapter submit/status path
- one MCP tool

### 悪い単位
- 3 adapters + 6 tools + DB schema を一気に入れる

---

## コミット単位

Conventional Commits を使う。

例:
- `feat(core): add task status schema`
- `feat(store): add sqlite session repository`
- `feat(adapters): add pi adapter submit/status flow`
- `feat(mcp): add submit_task tool`
- `test(store): cover task persistence and lookup`

---

## 実装判断ルール

### 迷ったら小さくする
- steering を入れるか迷ったら後回し
- artifacts テーブルを作るか迷ったら後回し
- projects/worktrees 正規化を迷ったら後回し

### 先に通すべき最小フロー

```text
submit_task
  -> task row created
  -> adapter launch
  -> get_task_status
  -> get_task_result
```

この一本が通ることを最優先にする。

---

## MVP 完了条件

最低限以下が揃っていること。

1. `sessions` / `tasks` state model が永続化される
2. 少なくとも 1 adapter が end-to-end で動く
3. MCP から submit/status/result/cancel を叩ける
4. result summary と result_ref/transcript_ref が返せる
5. steering が未実装でも protocol が破綻しない
