import { describe, expect, it } from "bun:test";

describe("tui argv lifecycle", () => {
	it("runs TUI before installing global process-exit signal handlers", async () => {
		const source = await Bun.file("packages/mcp/src/bin.ts").text();
		const runTuiIndex = source.indexOf("await runTui({ db, registry });");
		const signalIndex = source.indexOf("installSignalHandlers(db);");

		expect(runTuiIndex).toBeGreaterThan(-1);
		expect(signalIndex).toBeGreaterThan(-1);
		expect(runTuiIndex).toBeLessThan(signalIndex);
	});

	it("TUI branch closes its database after runTui returns", async () => {
		const source = await Bun.file("packages/mcp/src/bin.ts").text();
		expect(source).toContain("await runTui({ db, registry });\n\t\t\tcloseQuietly(db);");
	});
});
