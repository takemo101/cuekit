-- Persist the caller's full TaskSpec for recovery, audit, and later policy
-- enforcement (for example timeout_ms). The normalized task columns stay as
-- query-friendly projections; spec_json preserves optional protocol fields
-- like context, constraints, inputs, expected_output, and metadata.
alter table tasks add column spec_json text;
