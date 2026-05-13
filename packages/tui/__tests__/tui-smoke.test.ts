import { describe, expect, it } from "bun:test";
import { footerLine } from "../src/components/footer.tsx";

const TUI_FILES = [
	"../src/index.ts",
	"../src/app.tsx",
	"../src/components/task-list.tsx",
	"../src/components/task-detail.tsx",
	"../src/components/detail-tabs.tsx",
	"../src/components/footer.tsx",
	"../src/components/confirm-dialog.tsx",
	"../src/components/input-dialog.tsx",
	"../src/components/modal-frame.tsx",
	"../src/theme.ts",
	"../src/format.ts",
].map((path) => new URL(path, import.meta.url));

describe("@cuekit/tui package smoke", () => {
	it("keeps the expected TUI source modules in the tui package", async () => {
		for (const path of TUI_FILES) {
			expect(await Bun.file(path).exists()).toBe(true);
		}
		const entrypoint = await Bun.file(new URL("../src/index.ts", import.meta.url)).text();
		expect(entrypoint).toContain("export async function runTui");
		expect(entrypoint).toContain("export async function runTuiLoop");
		expect(entrypoint).toContain("createCliRenderer");
	});

	it("documents and wires the automatic refresh interval", async () => {
		const app = await Bun.file(new URL("../src/app.tsx", import.meta.url)).text();
		const footer = await Bun.file(new URL("../src/components/footer.tsx", import.meta.url)).text();
		expect(app).toContain("AUTO_REFRESH_MS");
		expect(app).toContain("setInterval");
		expect(footer).toContain("auto");
	});

	it("preserves the compact two-pane cockpit layout", async () => {
		const app = await Bun.file(new URL("../src/app.tsx", import.meta.url)).text();
		const taskList = await Bun.file(
			new URL("../src/components/task-list.tsx", import.meta.url),
		).text();
		expect(app).toContain("<TaskList");
		expect(app).toContain("maxVisibleRows={listRows}");
		expect(app).toContain("<TaskDetail");
		expect(app).toContain("task={selectedTask}");
		expect(app).toContain("detail={detail}");
		expect(taskList).toContain("const TASK_LIST_WIDTH = 42");
		expect(taskList).toContain("listWindow");
		expect(taskList).not.toContain("RESULT");
	});

	it("keeps detail output in a protected scrollbox", async () => {
		const detail = await Bun.file(
			new URL("../src/components/task-detail.tsx", import.meta.url),
		).text();
		expect(detail).toContain("function ContextPanel");
		expect(detail).toContain("return Math.min(12");
		expect(detail).toContain("TRANSCRIPT TAIL");
		expect(detail).toContain("LIVE OUTPUT");
		expect(detail).toContain("flexGrow={1} flexShrink={1}");
		expect(detail).toContain("function MetadataRow");
		expect(detail).toContain("function EventRow");
	});

	it("keeps footer and modal styling aligned with the shared theme", async () => {
		const footer = await Bun.file(new URL("../src/components/footer.tsx", import.meta.url)).text();
		const modal = await Bun.file(
			new URL("../src/components/modal-frame.tsx", import.meta.url),
		).text();
		expect(footer).toContain("↑/↓|j/k");
		expect(footerLine("Ready", 80).length).toBeLessThanOrEqual(76);
		expect(footerLine("Ready", 80, { attachable: false })).not.toContain("attach");
		expect(footerLine("Ready", 80, { attachable: false })).not.toContain("att");
		expect(
			footerLine("A very long status message that should be truncated", 80).length,
		).toBeLessThanOrEqual(76);
		expect(footerLine("Ready", 24).length).toBeLessThanOrEqual(20);
		expect(footerLine("Ready", 10).length).toBeLessThanOrEqual(6);
		expect(footerLine("Ready", 0)).toBe("");
		expect(modal).toContain("borderColor={theme.cyan}");
		expect(modal).toContain("backgroundColor={theme.panel}");
	});

	it("declares OpenTUI dependencies in @cuekit/tui", async () => {
		const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
		expect(pkg.name).toBe("@cuekit/tui");
		expect(pkg.dependencies["@opentui/core"]).toBeDefined();
		expect(pkg.dependencies["@opentui/react"]).toBeDefined();
		expect(pkg.dependencies.react).toBeDefined();
	});
});
