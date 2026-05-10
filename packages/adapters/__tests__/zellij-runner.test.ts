import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("defaultZellijRunner", () => {
	it("uses a non-blocking child process implementation", async () => {
		const source = await readFile(join(import.meta.dir, "../src/zellij-runner.ts"), "utf8");

		expect(source).not.toContain("execFileSync");
		expect(source).toContain("execFile");
	});
});
