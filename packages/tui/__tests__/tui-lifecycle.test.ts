import { describe, expect, it } from "bun:test";

const BIN_SOURCE = new URL("../../mcp/src/bin.ts", import.meta.url);

describe("tui argv lifecycle", () => {
	it("runs TUI before installing global process-exit signal handlers", async () => {
		const source = await Bun.file(BIN_SOURCE).text();
		const runTuiIndex = source.indexOf("await runTuiLoop(");
		const signalIndex = source.indexOf("installSignalHandlers(db);");

		expect(runTuiIndex).toBeGreaterThan(-1);
		expect(signalIndex).toBeGreaterThan(-1);
		expect(runTuiIndex).toBeLessThan(signalIndex);
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

	it("lazy-loads the TUI package from the TUI branch", async () => {
		const source = await Bun.file(BIN_SOURCE).text();
		expect(source).toContain('const TUI_PACKAGE_NAME = "@cuekit/tui";');
		expect(source).toContain("await import(TUI_PACKAGE_NAME)");
	});
});
