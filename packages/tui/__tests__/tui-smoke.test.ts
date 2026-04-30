import { describe, expect, it } from "bun:test";

const TUI_FILES = [
	"../src/index.ts",
	"../src/app.tsx",
	"../src/components/task-list.tsx",
	"../src/components/task-detail.tsx",
	"../src/components/footer.tsx",
	"../src/components/confirm-dialog.tsx",
	"../src/components/input-dialog.tsx",
].map((path) => new URL(path, import.meta.url));

describe("@cuekit/tui package smoke", () => {
	it("keeps the expected TUI source modules in the tui package", async () => {
		for (const path of TUI_FILES) {
			expect(await Bun.file(path).exists()).toBe(true);
		}
		const entrypoint = await Bun.file(new URL("../src/index.ts", import.meta.url)).text();
		expect(entrypoint).toContain("export async function runTui");
		expect(entrypoint).toContain("createCliRenderer");
	});

	it("declares OpenTUI dependencies in @cuekit/tui", async () => {
		const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
		expect(pkg.name).toBe("@cuekit/tui");
		expect(pkg.dependencies["@opentui/core"]).toBeDefined();
		expect(pkg.dependencies["@opentui/react"]).toBeDefined();
		expect(pkg.dependencies.react).toBeDefined();
	});
});
