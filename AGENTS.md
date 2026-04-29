# cuekit AI Guidelines

## 既知の設計方針

- Child reporting (post-v0/v2方針): 子エージェント報告は単一の MCP/CLI `report` 操作で SQLite `task_events` に保存する。`parent_notifications`/push/ack/transcript marker は具体的必要が出るまで実装しない。詳細 → [ADR 001](docs/decisions/001-child-reporting-surface.md)
