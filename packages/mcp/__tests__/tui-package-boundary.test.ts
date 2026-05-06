import { describe, expect, it } from "bun:test";

describe("tui package boundary", () => {
	it("keeps OpenTUI dependencies out of @cuekit/mcp", async () => {
		const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
		expect(pkg.dependencies["@opentui/core"]).toBeUndefined();
		expect(pkg.dependencies["@opentui/react"]).toBeUndefined();
		expect(pkg.dependencies.react).toBeUndefined();
		expect(pkg.dependencies["@cuekit/tui"]).toBeUndefined();
	});

	it("lazy-imports @cuekit/tui only from the CLI-owned human tui command path", async () => {
		const mcpSource = await Bun.file(new URL("../src/bin.ts", import.meta.url)).text();
		const cliSource = await Bun.file(new URL("../../cli/src/bin.ts", import.meta.url)).text();
		expect(mcpSource).not.toContain("@cuekit/tui");
		expect(cliSource).toContain('const TUI_PACKAGE_NAME = "@cuekit/tui";');
		expect(cliSource).toContain("await import(TUI_PACKAGE_NAME)");
		expect(cliSource).not.toContain('from "./tui/index.tsx"');
	});
});
