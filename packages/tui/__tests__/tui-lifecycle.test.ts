import { describe, expect, it } from "bun:test";

const BIN_SOURCE = new URL("../../cli/src/bin.ts", import.meta.url);

describe("tui argv lifecycle", () => {
	it("runs TUI from the CLI-owned human command path without global process-exit signal handlers", async () => {
		const source = await Bun.file(BIN_SOURCE).text();
		const runTuiIndex = source.indexOf("await runTuiLoop(");

		expect(runTuiIndex).toBeGreaterThan(-1);
		expect(source).not.toContain("installSignalHandlers(db);");
	});

	it("TUI branch closes its database after runTuiLoop returns", async () => {
		const source = await Bun.file(BIN_SOURCE).text();
		const runTuiIndex = source.indexOf("await runTuiLoop(");
		const closeIndex = source.indexOf("closeQuietly(db);", runTuiIndex);
		const returnIndex = source.indexOf("return;", closeIndex);

		expect(runTuiIndex).toBeGreaterThan(-1);
		expect(closeIndex).toBeGreaterThan(runTuiIndex);
		expect(returnIndex).toBeGreaterThan(closeIndex);
	});

	it("lazy-loads the TUI package from a bundler-visible literal import", async () => {
		const source = await Bun.file(BIN_SOURCE).text();
		expect(source).toContain('await import("@cuekit/tui")');
		expect(source).not.toContain("await import(TUI_PACKAGE_NAME)");
	});
});
