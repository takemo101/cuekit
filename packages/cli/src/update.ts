import pkg from "../package.json" with { type: "json" };

export type UpdateLatestReleaseResult = { ok: true; tag: string } | { ok: false; reason: string };

export type UpdateResult = {
	exitCode: number;
	stdout: string;
	stderr?: string;
};

export type RunUpdateOptions = {
	getCurrentVersion?: () => string | undefined;
	getLatestRelease?: () => Promise<UpdateLatestReleaseResult>;
};

const REPO = "takemo101/cuekit";

export async function getLatestGitHubRelease(): Promise<UpdateLatestReleaseResult> {
	try {
		const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
			headers: { accept: "application/vnd.github+json" },
		});
		if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
		const body = (await response.json()) as { tag_name?: unknown };
		return typeof body.tag_name === "string" && body.tag_name.length > 0
			? { ok: true, tag: body.tag_name }
			: { ok: false, reason: "missing tag_name" };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

function installCommand(tag: string): string {
	return `bun install -g github:${REPO}#${tag}`;
}

export async function runUpdate(options: RunUpdateOptions = {}): Promise<UpdateResult> {
	const current =
		options.getCurrentVersion !== undefined
			? (options.getCurrentVersion() ?? "unknown")
			: (pkg.version ?? "unknown");
	const latest = await (options.getLatestRelease ?? getLatestGitHubRelease)();
	const lines = ["cuekit update", "", `Current: ${current}`];

	if (latest.ok) {
		lines.push(`Latest:  ${latest.tag}`, "", "Run:", "", `  ${installCommand(latest.tag)}`, "");
	} else {
		lines.push(
			"Latest:  unknown",
			"",
			`Could not fetch the latest release tag: ${latest.reason}`,
			"Open https://github.com/takemo101/cuekit/releases and choose a release tag.",
			"",
			`Manual update pattern: ${installCommand("<release-tag>")}`,
			"(<release-tag> is a placeholder, not a discovered version.)",
			"",
		);
	}

	lines.push("Then restart any MCP client using cuekit.", "");
	return { exitCode: 0, stdout: lines.join("\n") };
}
