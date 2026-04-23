# Issue 004: adapter contract と最初の adapter spike を実装する

## 目的
runtime 差分を吸収する adapter 層を定義し、まず1本 end-to-end で通す。

## スコープ
`packages/adapters` に以下を実装する。

- `AgentAdapter` interface
- adapter registry
- result normalizer
- `PiAdapter`
- `ClaudeCodeAdapter` stub
- `OpenCodeAdapter` stub
- 可能なら 1 adapter を submit/status/collect/cancel まで動かす

## 完了条件
- adapter registry に登録できる
- capabilities を返せる
- 少なくとも1 adapterで以下が動く
  - submit
  - status
  - collect
  - cancel

## 受け入れ条件
- adapter contract が `docs/specs/2026-04-23-cuekit-adapter-spec.md` に一致する
- runtime-specific details は metadata に閉じ込められている
- steering は optional のまま扱われている
- stub adapter は unsupported capability を正直に返す
- runtime 境界の normalized output は Zod で検証される

## 依存
- Issue 002
- Issue 003

## 実装メモ
- 最初から3 adapter を完璧にしない
- 一番 controllable な runtime で spike する
- result normalization を transcript parsing 前提にしすぎない
- adapter 層に `incur` を持ち込まない
