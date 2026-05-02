import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { discoverProjectConfig, projectIdentityFromConfig } from "../src/discovery.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "cuekit-project-config-"));
}

describe("project config discovery", () => {
	it("finds the nearest parent .cuekit.yaml", () => {
		const root = tempDir();
		try {
			const nested = join(root, "packages", "mcp");
			mkdirSync(nested, { recursive: true });
			writeFileSync(join(root, ".cuekit.yaml"), "project:\n  id: cuekit\n");

			const discovered = discoverProjectConfig(nested);

			expect(discovered.source).toBe("config");
			expect(discovered.configRoot).toBe(resolve(root));
			expect(discovered.configPath).toBe(join(resolve(root), ".cuekit.yaml"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("falls back to git root when no config exists", () => {
		const root = tempDir();
		try {
			const nested = join(root, "src");
			mkdirSync(join(root, ".git"), { recursive: true });
			mkdirSync(nested, { recursive: true });

			const discovered = discoverProjectConfig(nested);

			expect(discovered.source).toBe("git");
			expect(discovered.projectRoot).toBe(resolve(root));
			expect(discovered.configPath).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("falls back to cwd when neither config nor git root exists", () => {
		const root = tempDir();
		try {
			const discovered = discoverProjectConfig(root);
			expect(discovered.source).toBe("cwd");
			expect(discovered.projectRoot).toBe(resolve(root));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("derives safe identity from config root and project id", () => {
		const root = resolve("/tmp/cuekit-a");
		const identity = projectIdentityFromConfig({
			configRoot: root,
			projectRoot: root,
			config: { project: { id: "cuekit", name: "Cuekit" } },
		});

		expect(identity.config_root).toBe(root);
		expect(identity.project_id).toBe("cuekit");
		expect(identity.project_name).toBe("Cuekit");
		expect(identity.project_uid).toMatch(/^pc_[a-f0-9]{16}$/);
	});

	it("derives a safe identity when project id is omitted", () => {
		const root = resolve("/tmp/cuekit-no-id");
		const identity = projectIdentityFromConfig({
			configRoot: root,
			projectRoot: root,
			config: { project: { name: "No ID" } },
		});

		expect(identity.project_id).toContain(basename(root));
		expect(identity.project_id).not.toBe("undefined");
		expect(identity.project_uid).toMatch(/^pc_[a-f0-9]{16}$/);
	});

	it("uses different project_uid values for same project id in different roots", () => {
		const a = projectIdentityFromConfig({
			configRoot: resolve("/tmp/repo-a"),
			projectRoot: resolve("/tmp/repo-a"),
			config: { project: { id: "same" } },
		});
		const b = projectIdentityFromConfig({
			configRoot: resolve("/tmp/repo-b"),
			projectRoot: resolve("/tmp/repo-b"),
			config: { project: { id: "same" } },
		});

		expect(a.project_uid).not.toBe(b.project_uid);
	});
});
