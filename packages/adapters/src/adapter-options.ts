import type { TaskSpec } from "@cuekit/core";

// Shared adapter option parsing. Keep permission bypass opt-in: only the
// boolean literal `true` enables the dangerous runtime flag; false, missing,
// strings, or other truthy-looking values preserve the safe default.
export function shouldDangerouslySkipPermissions(spec: TaskSpec): boolean {
	return spec.adapter_options?.dangerously_skip_permissions === true;
}
