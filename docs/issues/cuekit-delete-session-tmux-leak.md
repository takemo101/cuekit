# Bug report: `delete_session` 後に tmux task session が残る

## 概要

`cuekit_delete_session` で cuekit の session/task レコードは削除されるが、対応する tmux session (`cuekit-task-<task_id>`) が残るケースがある。

ユーザー視点では「セッション削除したのに対象セッションが消えていない」挙動に見える。

## 再現時の実例

- session_id: `s_fd5cfb701fc6`
- task_id: `t_92d2bda916f7`
- tmux session: `cuekit-task-t_92d2bda916f7`

### 実行した操作

1. Claude Code adapter で task を submit
2. task が child reporting 経由で `completed` になる
3. `cuekit_get_task_result` で completed result を取得
4. `cuekit_delete_session` を実行

```json
{"ok":true,"message":"deleted session 's_fd5cfb701fc6' and 3 task(s)"}
```

5. その後、cuekit 側の task 一覧は空

```json
{"tasks":[],"has_more":false}
```

6. しかし tmux session は残存

```text
cuekit-task-t_92d2bda916f7: 1 windows (created Thu Apr 30 07:35:54 2026) (attached)
```

手動で以下を実行すると消えた。

```bash
tmux kill-session -t cuekit-task-t_92d2bda916f7
```

## 期待動作

少なくとも以下のどちらかになるべき。

1. terminal task への遷移時に対応する tmux session が kill される
2. `delete_session` が削除対象 task に紐づく tmux session を cleanup する

README の記述では以下が期待されている。

> tmux sessions: one session per task named `cuekit-task-<id>`. Killed on terminal transition or explicit cancel.

## 実際の動作

- DB 上の session/task は削除される
- tmux session は残る
- `delete_session` 後は DB から task 情報が消えるため、cuekit 経由で cleanup しづらくなる

## 推定原因

`report_task_event(type: "completed")` による terminal transition が、tmux pane/session cleanup を実行していない可能性が高い。

関連箇所:

- `packages/mcp/src/commands/report-task-event.ts`
  - `completed` / `failed` / `blocked` report で `updateTaskStatus(...)` を呼ぶ
  - adapter の `onTerminal` や pane backend の `killTask` には到達していないように見える

- `packages/mcp/src/commands/delete-session.ts`
  - 全 task が terminal であることだけ確認し、`deleteSession(ctx.db, session_id)` を実行
  - コメント上も DB/artifact cleanup のみで、tmux cleanup はしていない

- `packages/adapters/src/pane-adapter.ts`
  - `cancel(...)` では `panes.killTask(task_id)` を呼ぶ
  - `status(...)` で pane death や timeout を検知した場合も terminal 処理経路がある
  - しかし child report による terminal status update は MCP command 側で直接行われるため、pane cleanup が漏れる構造に見える

## 影響

- terminal/completed な task の tmux session が孤児化する
- `delete_session` 後は task row が消えるため、残存 tmux session と cuekit state の対応関係が失われる
- ユーザーが `tmux list-sessions` / `tmux kill-session` で手動 cleanup する必要がある

## 修正方針案

### 案 A: child report の terminal transition 時に pane を kill する

`report_task_event` で `completed` / `failed` / `blocked` を受けたとき、task の adapter/backend を通じて `killTask(task_id)` 相当を実行する。

メリット:

- README の「terminal transition で kill」に合う
- DB 削除前に cleanup されるため孤児化しにくい

注意点:

- `report_task_event` は MCP command 層なので、adapter/pane backend にどうアクセスするか設計確認が必要
- child が report 後に正常終了する前に pane を kill してよいか、または report 後の猶予/終了待ちが必要か検討が必要

### 案 B: `delete_session` / `delete_task` で best-effort tmux cleanup する

DB 削除前に、削除対象 task ids から `cuekit-task-<task_id>` を組み立てて `tmux kill-session` を best-effort 実行する。

メリット:

- ユーザーが期待する「削除したら消える」に近い
- DB 削除前なら task_id が分かる

注意点:

- 現状コメントでは deletion は pure DB management operation とされているため、仕様変更になる
- artifact cleanup とは別に tmux cleanup だけ行う理由を明文化する必要がある

### 案 C: A + B の防御的対応

- terminal transition で cleanup
- delete 系でも orphan 防止の best-effort cleanup

最もユーザー体験は良いが、責務分離は要検討。

## 最小検証案

1. child report で `completed` になる fake/real tmux task を作る
2. `get_task_status` が `completed` になることを確認
3. `tmux has-session -t cuekit-task-<task_id>` が失敗することを期待するテストを追加
4. `delete_session` 後にも `tmux has-session` が失敗することを確認

既存の real tmux integration tests があるため、そこに regression test を追加できそう。

関連候補:

- `packages/adapters/__tests__/pane-adapter-integ.test.ts`
- `packages/mcp/__tests__/mcp-stdio-integ.test.ts`
- `packages/mcp/__tests__/commands.test.ts`

## 補足

今回の実例では、Claude Code 側に Muxy stop hook error 表示もあったが、cuekit 上の status は `completed` で、問題の本質は tmux session cleanup 漏れと考えられる。
