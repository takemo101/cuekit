import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
	applyCuekitGitignoreEntry,
	deriveProjectId,
	renderProjectConfigTemplate,
	runProjectConfigInit,
} from "../src/init.ts";
import { CuekitProjectConfigSchema } from "../src/schema.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "cuekit-init-"));
}

describe("deriveProjectId", () => {
	it("sanitizes directory names into valid project ids", () => {
		expect(deriveProjectId("My App!")).toBe("My-App");
		expect(deriveProjectId("cuekit.core")).toBe("cuekit.core");
		expect(deriveProjectId("!!!")).toBe("project");
	});
});

describe("renderProjectConfigTemplate", () => {
	it("renders safe config without submit defaults or delete-empty-team", () => {
		const text = renderProjectConfigTemplate({ projectId: "my-app", projectName: "My App" });

		expect(text).toContain("scope: project");
		expect(text).toContain("permissions: prompt");
		expect(text).not.toContain("submit:");
		expect(text).not.toContain("delete-empty-team");
		const parsed = CuekitProjectConfigSchema.parse(parse(text));
		expect(parsed.project?.id).toBe("my-app");
		expect(parsed.project?.name).toBe("My App");
	});

	it("renders unsafe bypass adapter permissions when explicitly requested", () => {
		const text = renderProjectConfigTemplate({
			projectId: "my-app",
			projectName: "My App",
			permissions: "bypass",
		});

		const parsed = CuekitProjectConfigSchema.parse(parse(text));
		expect(parsed.adapters?.["claude-code"]?.permissions).toBe("bypass");
		expect(parsed.adapters?.opencode?.permissions).toBe("bypass");
		expect(text).not.toContain("delete-empty-team");
	});

	it("quotes YAML-sensitive generated project values", () => {
		const text = renderProjectConfigTemplate({
			projectId: "123",
			projectName: "true: # app",
		});

		const parsed = CuekitProjectConfigSchema.parse(parse(text));
		expect(parsed.project?.id).toBe("123");
		expect(parsed.project?.name).toBe("true: # app");
	});
});

describe("applyCuekitGitignoreEntry", () => {
	it("adds only .cuekit/tasks to gitignore", () => {
		const next = applyCuekitGitignoreEntry("dist/\n");

		expect(next).toContain("dist/\n");
		expect(next).toContain("# cuekit local task artifacts");
		expect(next).toContain(".cuekit/tasks/");
		expect(next).not.toContain(".cuekit/\n");
	});

	it("does not duplicate existing cuekit task entries", () => {
		const current = "dist/\n# cuekit local task artifacts\n.cuekit/tasks/\n";
		expect(applyCuekitGitignoreEntry(current)).toBe(current);
	});
});

describe("runProjectConfigInit", () => {
	it("creates .cuekit.yaml and .gitignore", () => {
		const root = tempDir();
		try {
			const result = runProjectConfigInit({ cwd: root });

			expect(result.created).toContain(join(root, ".cuekit.yaml"));
			expect(result.created).toContain(join(root, ".gitignore"));
			expect(readFileSync(join(root, ".cuekit.yaml"), "utf8")).toContain("scope: project");
			expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".cuekit/tasks/");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("refuses an existing config unless force is true", () => {
		const root = tempDir();
		try {
			writeFileSync(join(root, ".cuekit.yaml"), "project:\n  id: existing\n");

			expect(() => runProjectConfigInit({ cwd: root })).toThrow(/already exists/);
			runProjectConfigInit({ cwd: root, force: true });
			expect(readFileSync(join(root, ".cuekit.yaml"), "utf8")).not.toContain("existing");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("dry-run reports intended writes without changing disk", () => {
		const root = tempDir();
		try {
			const result = runProjectConfigInit({ cwd: root, dryRun: true });

			expect(result.dryRun).toBe(true);
			expect(result.created).toContain(join(root, ".cuekit.yaml"));
			expect(() => readFileSync(join(root, ".cuekit.yaml"), "utf8")).toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("can write unsafe bypass permissions when explicitly requested", () => {
		const root = tempDir();
		try {
			runProjectConfigInit({ cwd: root, unsafeBypass: true });

			const parsed = CuekitProjectConfigSchema.parse(
				parse(readFileSync(join(root, ".cuekit.yaml"), "utf8")),
			);
			expect(parsed.adapters?.["claude-code"]?.permissions).toBe("bypass");
			expect(parsed.adapters?.opencode?.permissions).toBe("bypass");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("can skip gitignore updates", () => {
		const root = tempDir();
		try {
			runProjectConfigInit({ cwd: root, gitignore: false });

			expect(readFileSync(join(root, ".cuekit.yaml"), "utf8")).toContain("scope: project");
			expect(() => readFileSync(join(root, ".gitignore"), "utf8")).toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("updates an existing gitignore without losing content", () => {
		const root = tempDir();
		try {
			mkdirSync(join(root, "nested"));
			writeFileSync(join(root, ".gitignore"), "dist/\n");

			const result = runProjectConfigInit({ cwd: root });

			expect(result.updated).toContain(join(root, ".gitignore"));
			const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
			expect(gitignore).toContain("dist/\n");
			expect(gitignore).toContain(".cuekit/tasks/");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
