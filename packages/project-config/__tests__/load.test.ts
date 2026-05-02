import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectConfig } from "../src/load.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "cuekit-project-config-load-"));
}

describe("loadProjectConfig", () => {
	it("parses valid YAML", () => {
		const root = tempDir();
		try {
			writeFileSync(join(root, ".cuekit.yaml"), "project:\n  id: cuekit\ntui:\n  scope: project\n");
			const loaded = loadProjectConfig(root);

			expect(loaded.ok).toBe(true);
			if (loaded.ok) {
				expect(loaded.config.project?.id).toBe("cuekit");
				expect(loaded.discovery.source).toBe("config");
				expect(loaded.identity.project_uid).toMatch(/^pc_[a-f0-9]{16}$/);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns a no-config result when config is missing", () => {
		const root = tempDir();
		try {
			mkdirSync(join(root, ".git"));
			const loaded = loadProjectConfig(root);

			expect(loaded.ok).toBe(true);
			if (loaded.ok) {
				expect(loaded.config).toEqual({});
				expect(loaded.discovery.configPath).toBeUndefined();
				expect(loaded.identity.project_uid).toBeUndefined();
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns a clear error for malformed YAML", () => {
		const root = tempDir();
		try {
			writeFileSync(join(root, ".cuekit.yaml"), "project: [");
			const loaded = loadProjectConfig(root);

			expect(loaded.ok).toBe(false);
			if (!loaded.ok) {
				expect(loaded.path).toContain(".cuekit.yaml");
				expect(loaded.error).toContain("Failed to parse");
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns a clear error for invalid schema", () => {
		const root = tempDir();
		try {
			writeFileSync(join(root, ".cuekit.yaml"), "tui:\n  scope: all\n");
			const loaded = loadProjectConfig(root);

			expect(loaded.ok).toBe(false);
			if (!loaded.ok) {
				expect(loaded.path).toContain(".cuekit.yaml");
				expect(loaded.error).toContain("Invalid cuekit project config");
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
