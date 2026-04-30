import { describe, expect, it } from "bun:test";

const TUI_FILES = [
	"../src/tui/index.tsx",
	"../src/tui/app.tsx",
	"../src/tui/components/task-list.tsx",
	"../src/tui/components/task-detail.tsx",
	"../src/tui/components/footer.tsx",
	"../src/tui/components/confirm-dialog.tsx",
	"../src/tui/components/input-dialog.tsx",
].map((path) => new URL(path, import.meta.url));

describe("tui module smoke", () => {
	it("keeps the expected TUI source modules in place", async () => {
		for (const path of TUI_FILES) {
			expect(await Bun.file(path).exists()).toBe(true);
		}
		const entrypoint = await Bun.file(new URL("../src/tui/index.tsx", import.meta.url)).text();
		expect(entrypoint).toContain("export async function runTui");
		expect(entrypoint).toContain("createCliRenderer");
	});
});
