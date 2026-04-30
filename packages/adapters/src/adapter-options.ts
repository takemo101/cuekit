import type { TaskSpec } from "@cuekit/core";

// Shared adapter option parsing. Permission bypass is enabled by default for
// delegated panes so unattended child agents don't stall on runtime prompts.
// The boolean literal `false` is the explicit opt-out; missing, true, strings,
// or other values keep the default enabled behavior.
export function shouldDangerouslySkipPermissions(spec: TaskSpec): boolean {
	return spec.adapter_options?.dangerously_skip_permissions !== false;
}
