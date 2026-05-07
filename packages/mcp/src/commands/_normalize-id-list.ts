/**
 * Normalize a list of CLI ID flag values into a flat string array.
 *
 * Cuekit CLI array flags (`--task_ids`, `--session_ids`) are documented as
 * repeatable: `--task_ids t_a --task_ids t_b`. The `incur` argv parser
 * collects each `--flag value` into the array verbatim, so a user-friendly
 * comma form like `--task_ids "t_a,t_b"` arrives here as `["t_a,t_b"]`,
 * which downstream lookups would treat as a single literal id.
 *
 * Splitting each element on commas and trimming whitespace makes both forms
 * (and any mix of them) work without changing the Zod schema shape that
 * `incur` uses to detect array flags.
 *
 * IDs themselves never contain commas, so the split is unambiguous. Empty
 * fragments — produced by leading/trailing/consecutive commas — are dropped
 * so callers do not have to handle them as `id_not_found` errors.
 */
export function normalizeIdList(values: readonly string[]): string[] {
	return values
		.flatMap((value) => value.split(","))
		.map((id) => id.trim())
		.filter((id) => id.length > 0);
}
