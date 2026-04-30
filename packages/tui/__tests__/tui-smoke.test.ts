import { describe, expect, it } from "bun:test";

const TUI_FILES = [
	"../src/index.ts",
	"../src/app.tsx",
	"../src/components/task-list.tsx",
	"../src/components/task-detail.tsx",
	"../src/components/footer.tsx",
	"../src/components/confirm-dialog.tsx",
	"../src/components/input-dialog.tsx",
	"../src/components/modal-frame.tsx",
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

	it("documents and wires the automatic refresh interval", async () => {
		const app = await Bun.file(new URL("../src/app.tsx", import.meta.url)).text();
		const footer = await Bun.file(new URL("../src/components/footer.tsx", import.meta.url)).text();
		expect(app).toContain("AUTO_REFRESH_MS");
		expect(app).toContain("setInterval");
		expect(footer).toContain("auto");
	});

	it("declares OpenTUI dependencies in @cuekit/tui", async () => {
		const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
		expect(pkg.name).toBe("@cuekit/tui");
		expect(pkg.dependencies["@opentui/core"]).toBeDefined();
		expect(pkg.dependencies["@opentui/react"]).toBeDefined();
		expect(pkg.dependencies.react).toBeDefined();
	});
});
