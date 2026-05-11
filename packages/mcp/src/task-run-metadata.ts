import { TaskSpecSchema } from "@cuekit/core";
import type { Task } from "@cuekit/store";

export type TaskRunMetadata = {
	run_kind?: string;
	long_lived?: boolean;
};

export function taskRunMetadata(task: Task): TaskRunMetadata {
	if (!task.spec_json) return {};
	try {
		const parsed = TaskSpecSchema.safeParse(JSON.parse(task.spec_json));
		if (!parsed.success) return {};
		const metadata = parsed.data.metadata;
		const out: TaskRunMetadata = {};
		if (typeof metadata?.run_kind === "string" && metadata.run_kind.length > 0) {
			out.run_kind = metadata.run_kind;
		}
		if (typeof metadata?.long_lived === "boolean") {
			out.long_lived = metadata.long_lived;
		}
		return out;
	} catch {
		return {};
	}
}
