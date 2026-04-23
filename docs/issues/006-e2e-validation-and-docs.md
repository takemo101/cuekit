# Issue 006: e2e validation と docs 整備を行う

## 目的
cuekit v0 の最小フローが end-to-end で成立することを確認し、README と docs を更新する。

## スコープ
- submit -> status -> result の smoke validation
- cancel path の確認（可能なら）
- root README 更新
- docs index の整合確認

## 完了条件
- 少なくとも1 adapter で最小 delegation flow が通る
- `result_ref` / `transcript_ref` の生成位置が一貫している
- root README から docs に辿れる
- workspace 全体の test / typecheck / check が通る

## 受け入れ条件
- e2e flow が文書化されている
- v0 の scope と non-goals が README に反映されている
- docs/specs と docs/architecture のリンクが壊れていない
- 実装済みの adapter capability が docs と矛盾していない

## 依存
- Issue 001
- Issue 002
- Issue 003
- Issue 004
- Issue 005

## 実装メモ
- この issue では scope を広げない
- workflow/kanban/memory platform 的なものを追加しない
- 必要なら未実装 capability は README で明示する
