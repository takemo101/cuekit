# cuekit アーキテクチャ・エラーハンドリング

> See [`../specs/README.md`](../specs/README.md) for the protocol and state model that these error rules apply to.

## 基本方針

cuekit では、**recoverable な問題は structured error** として返し、
**defect や corruption は throw** で止める。

この区別を曖昧にしない。

---

## 4分類

## 1. Error

呼び出し元が扱える想定内の問題。

例:
- adapter が見つからない
- task が terminal でないのに collect を呼んだ
- runtime が steering をサポートしない
- native status refresh が一時的に失敗した

対処:
- `JobError` を返す
- MCP では structured payload にする

## 2. Defect

本来発生してはいけない、設計・実装上のバグ。

例:
- impossible state transition
- schema parse 済みのはずの row が invariant を破っている
- exhaustive switch 漏れ

対処:
- throw
- 即停止
- 握り潰さない

## 3. Fault

外部環境や infra に起因する機能遂行不能状態。

例:
- SQLite file open failure
- filesystem permission denied
- child runtime binary missing
- transport disconnection

対処:
- structured error として surface できるなら返す
- process 継続不能なら fail fast

## 4. Failure

session や task が最終的に目的を達成できなかった状態。

例:
- task status = `failed`
- session status = `failed`
- task status = `timed_out`
- task status = `blocked`

対処:
- terminal state として persist
- summary / refs / error を残す

---

## JobError

cuekit では recoverable error を `JobError` で扱う。

```ts
interface JobError {
  code:
    | "adapter_not_found"
    | "submit_failed"
    | "status_unavailable"
    | "steering_unsupported"
    | "collect_unavailable"
    | "task_not_found"
    | "invalid_state"
    | "runtime_crash"
    | "timeout"
    | "malformed_result"
    | "permission_denied"
    | "transport_error"
    | "unknown";
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}
```

> Note: protocol docs で `job_not_found` を使っていたとしても、task-centric surface へ寄せる時は命名を揃える。v0 実装では 1 系統に統一すること。

---

## 層ごとのルール

## Core

- 原則 throw しない
- invalid state は explicit な error/result で返す
- impossible invariant のみ throw

例:

```ts
const result = ensureCollectable(status);
if (!result.ok) return result;
```

## Store

- DB query miss は recoverable なら `task_not_found`
- row decode failure は corruption 寄りなので強く扱う
- migration failure は process 継続不能なら throw

## Adapters

- runtime-specific failure を `JobError` に translate する
- native details は `details` に残す
- steering unsupported は明示する
- collect 不能なら fabricate しない

## MCP

- malformed tool input は MCP/tool error
- protocol-level invalid state は structured error payload
- internal invariant break は server error

---

## Recoverable vs Unrecoverable

| 状態 | 例 | 扱い |
|---|---|---|
| Recoverable | invalid_state | `JobError` |
| Recoverable | adapter_not_found | `JobError` |
| Recoverable | steering_unsupported | `JobError` |
| Recoverable | timeout | terminal task state + `JobError` |
| Unrecoverable | corrupted row shape | throw |
| Unrecoverable | impossible enum branch | throw |
| Unrecoverable | broken migration invariant | throw |

---

## 例外を握り潰さない

悪い例:

```ts
try {
  return adapter.collect(task_id);
} catch {
  return unknownError();
}
```

良い例:

```ts
try {
  return adapter.collect(task_id);
} catch (error) {
  throw new Error(`defect: unexpected adapter.collect crash`, { cause: error });
}
```

ただし、native runtime error を adapter boundary で structured 化できるなら、そこで convert してよい。

---

## 状態遷移エラー

cuekit では状態遷移を曖昧にしない。

例:
- `running -> queued` は defect
- `completed -> running` は defect
- `running -> completed` は正常
- `running -> timed_out` は正常

state transition helper は、このルールを一元管理する。

---

## Persist first when possible

task が失敗した場合、可能な限り以下を残す。

- terminal status
- summary
- error
- result_ref or transcript_ref

つまり「失敗しても痕跡を残す」を優先する。

---

## レビューチェックリスト

- [ ] recoverable error を throw していないか
- [ ] defect を generic error payload に落として握り潰していないか
- [ ] adapter が native error を structured に翻訳しているか
- [ ] invalid state が explicit に扱われているか
- [ ] terminal failure 時に summary/ref/error を残しているか
