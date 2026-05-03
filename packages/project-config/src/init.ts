import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";

export const CUEKIT_GITIGNORE_ENTRY = ".cuekit/tasks/";
const CUEKIT_GITIGNORE_COMMENT = "# cuekit local task artifacts";

export function deriveProjectId(name: string): string {
	const sanitized = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return sanitized.length > 0 ? sanitized : "project";
}

export interface RenderProjectConfigTemplateInput {
	projectId: string;
	projectName: string;
	permissions?: "prompt" | "bypass";
}

export function renderProjectConfigTemplate(input: RenderProjectConfigTemplateInput): string {
	const permissions = input.permissions ?? "prompt";
	const project = stringify({
		project: { id: input.projectId, name: input.projectName },
	}).trimEnd();
	return `${project}

# Scope TUI views to this project by default.
tui:
  scope: project

submit:
  # Defaults for submit_task. Explicit request fields always win.
  # If role is set, the selected Agent Profile can still provide agent/model.
  role: worker
  agent: claude-code
  model: sonnet
  timeout_ms: 1800000
  priority: normal

teams:
  roles:
    # Default Agent Profile role per team position.
    coordinator: planner
    worker: worker
    reviewer: reviewer
  wait:
    # Defaults for wait_team unless request fields override them.
    timeout_ms: 300000
    poll_interval_ms: 2000
  # Planned/inactive until cuekit has a delete_team operation.
  cleanup: keep-team

adapters:
  claude-code:
    # prompt keeps generated config safe. Use --unsafe-bypass only for trusted repos.
    permissions: ${permissions}
  opencode:
    permissions: ${permissions}
`;
}

export function applyCuekitGitignoreEntry(current: string): string {
	const lines = current.split(/\r?\n/);
	if (lines.includes(CUEKIT_GITIGNORE_ENTRY)) return current;
	const prefix = current.length === 0 || current.endsWith("\n") ? current : `${current}\n`;
	return `${prefix}${prefix.length > 0 ? "\n" : ""}${CUEKIT_GITIGNORE_COMMENT}\n${CUEKIT_GITIGNORE_ENTRY}\n`;
}

export interface ProjectConfigInitOptions {
	cwd: string;
	dryRun?: boolean;
	force?: boolean;
	gitignore?: boolean;
	unsafeBypass?: boolean;
}

export interface ProjectConfigInitResult {
	cwd: string;
	configPath: string;
	gitignorePath?: string;
	created: string[];
	updated: string[];
	skipped: string[];
	dryRun: boolean;
}

function recordWrite(input: {
	path: string;
	exists: boolean;
	content: string;
	dryRun: boolean;
	created: string[];
	updated: string[];
}): void {
	if (input.exists) {
		input.updated.push(input.path);
	} else {
		input.created.push(input.path);
	}
	if (!input.dryRun) writeFileSync(input.path, input.content);
}

export function runProjectConfigInit(options: ProjectConfigInitOptions): ProjectConfigInitResult {
	const cwd = resolve(options.cwd);
	const dryRun = options.dryRun ?? false;
	const force = options.force ?? false;
	const shouldUpdateGitignore = options.gitignore ?? true;
	const configPath = join(cwd, ".cuekit.yaml");
	const gitignorePath = join(cwd, ".gitignore");
	const created: string[] = [];
	const updated: string[] = [];
	const skipped: string[] = [];

	const configExists = existsSync(configPath);
	if (configExists && !force) {
		throw new Error(`project config already exists: ${configPath}`);
	}
	const projectName = basename(cwd) || "project";
	const configText = renderProjectConfigTemplate({
		projectId: deriveProjectId(projectName),
		projectName,
		permissions: options.unsafeBypass ? "bypass" : "prompt",
	});
	recordWrite({
		path: configPath,
		exists: configExists,
		content: configText,
		dryRun,
		created,
		updated,
	});

	if (shouldUpdateGitignore) {
		const gitignoreExists = existsSync(gitignorePath);
		const current = gitignoreExists ? readFileSync(gitignorePath, "utf8") : "";
		const next = applyCuekitGitignoreEntry(current);
		if (next === current) {
			skipped.push(gitignorePath);
		} else {
			recordWrite({
				path: gitignorePath,
				exists: gitignoreExists,
				content: next,
				dryRun,
				created,
				updated,
			});
		}
	} else {
		skipped.push(gitignorePath);
	}

	return {
		cwd,
		configPath,
		...(shouldUpdateGitignore ? { gitignorePath } : {}),
		created,
		updated,
		skipped,
		dryRun,
	};
}
