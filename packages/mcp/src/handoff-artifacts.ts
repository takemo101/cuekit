import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { TaskSpecSchema, taskArtifactPaths } from "@cuekit/core";
import type { Task } from "@cuekit/store";

export type HandoffArtifact = {
	absolutePath: string;
	relativePath: string;
};

export async function writeHandoffArtifact(params: {
	task: Task;
	event_id: string;
	message: string;
}): Promise<HandoffArtifact> {
	const cwd = taskCwd(params.task);
	const paths = taskArtifactPaths(cwd, params.task.id);
	const handoffDir = join(paths.dir, "handoffs");
	const absolutePath = join(handoffDir, `${params.event_id}.md`);
	await mkdir(handoffDir, { recursive: true });
	await writeFile(absolutePath, params.message, "utf8");
	return {
		absolutePath,
		relativePath: relative(cwd, absolutePath),
	};
}

export async function removeHandoffArtifact(artifact: HandoffArtifact): Promise<void> {
	await rm(artifact.absolutePath, { force: true });
}

function taskCwd(task: Task): string {
	if (!task.spec_json) return process.cwd();
	try {
		const parsed = TaskSpecSchema.safeParse(JSON.parse(task.spec_json));
		if (parsed.success && parsed.data.cwd) return parsed.data.cwd;
	} catch {
		// fall through
	}
	return process.cwd();
}
