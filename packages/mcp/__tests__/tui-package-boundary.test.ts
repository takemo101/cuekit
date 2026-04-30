import { describe, expect, it } from "bun:test";

describe("tui package boundary", () => {
	it("keeps OpenTUI dependencies out of @cuekit/mcp", async () => {
		const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
		expect(pkg.dependencies["@opentui/core"]).toBeUndefined();
		expect(pkg.dependencies["@opentui/react"]).toBeUndefined();
		expect(pkg.dependencies.react).toBeUndefined();
		expect(pkg.dependencies["@cuekit/tui"]).toBe("workspace:*");
	});

	it("lazy-imports @cuekit/tui only from the human tui command path", async () => {
		const source = await Bun.file(new URL("../src/bin.ts", import.meta.url)).text();
		expect(source).toContain('const TUI_PACKAGE_NAME = "@cuekit/tui";');
		expect(source).toContain("await import(TUI_PACKAGE_NAME)");
		expect(source).not.toContain('from "./tui/index.tsx"');
	});
});
