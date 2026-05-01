import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgentProfiles } from "../src/discovery.ts";
import { findProjectRoot } from "../src/project-root.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "cuekit-agent-profiles-"));
}

describe("findProjectRoot", () => {
	it("anchors at nearest .git directory", () => {
		const root = tempDir();
		try {
			mkdirSync(join(root, ".git"));
			mkdirSync(join(root, "nested", "leaf"), { recursive: true });
			expect(findProjectRoot(join(root, "nested", "leaf"), fs)).toBe(root);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("anchors at nearest .git file", () => {
		const root = tempDir();
		try {
			writeFileSync(join(root, ".git"), "gitdir: ../repo.git");
			expect(findProjectRoot(root, fs)).toBe(root);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("discoverAgentProfiles", () => {
	it("loads builtins when user and project dirs are missing", () => {
		const root = tempDir();
		try {
			mkdirSync(join(root, ".git"));
			const result = discoverAgentProfiles({ cwd: root, userDir: join(root, "missing-user") });
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.profiles.map((profile) => profile.id)).toContain("worker");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("loads user and project markdown profiles with project precedence", () => {
		const root = tempDir();
		const userDir = join(root, "user-agents");
		try {
			mkdirSync(join(root, ".git"));
			mkdirSync(join(root, ".cuekit", "agents"), { recursive: true });
			mkdirSync(userDir, { recursive: true });
			writeFileSync(join(userDir, "reviewer.md"), "---\nid: reviewer\nmodel: opus\n---");
			writeFileSync(
				join(root, ".cuekit", "agents", "reviewer.md"),
				"---\nid: reviewer\nmodel: haiku\n---",
			);
			const result = discoverAgentProfiles({ cwd: root, userDir });
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.profiles.find((profile) => profile.id === "reviewer")?.model).toBe("haiku");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns parse errors for malformed profiles", () => {
		const root = tempDir();
		try {
			mkdirSync(join(root, ".git"));
			mkdirSync(join(root, ".cuekit", "agents"), { recursive: true });
			writeFileSync(join(root, ".cuekit", "agents", "broken.md"), "---\nid: broken");
			const result = discoverAgentProfiles({ cwd: root, userDir: join(root, "missing-user") });
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error).toContain("unterminated frontmatter");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
