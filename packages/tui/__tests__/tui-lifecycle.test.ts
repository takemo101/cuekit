import { describe, expect, it } from "bun:test";

const BIN_SOURCE = new URL("../../cli/src/bin.ts", import.meta.url);
const APP_SOURCE = new URL("../src/app.tsx", import.meta.url);

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

	it("keeps runtime warnings out of the alternate-screen TUI", async () => {
		const source = await Bun.file(BIN_SOURCE).text();
		const tuiLoggerIndex = source.indexOf("const tuiLogger = silentLogger;");
		const buildBackendIndex = source.indexOf("buildMultiplexerBackend", tuiLoggerIndex);
		const buildRegistryIndex = source.indexOf("buildTuiAdapterRegistry", tuiLoggerIndex);

		expect(tuiLoggerIndex).toBeGreaterThan(-1);
		expect(buildBackendIndex).toBeGreaterThan(tuiLoggerIndex);
		expect(buildRegistryIndex).toBeGreaterThan(tuiLoggerIndex);
		expect(source).toContain("{ logger: tuiLogger }");
	});

	it("debounces detail loading so selection movement stays responsive", async () => {
		const source = await Bun.file(APP_SOURCE).text();

		expect(source).toContain("DEFAULT_DETAIL_LOAD_DEBOUNCE_MS");
		expect(source).toContain("detailLoadDebounceMs");
		expect(source).toContain("setDebouncedTaskDetailId");
		expect(source).toContain("setDebouncedTeamDetailId");
		expect(source).toContain("setTimeout(() =>");
		expect(source).toContain("detailRefreshTick");
	});
});
