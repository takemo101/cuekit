import { describe, expect, it } from "bun:test";

describe("tui module smoke", () => {
	it("exports the TUI entrypoint and components", async () => {
		const [
			{ runTui },
			{ App },
			{ TaskList },
			{ TaskDetail },
			{ Footer },
			{ ConfirmDialog },
			{ InputDialog },
		] = await Promise.all([
			import("../src/tui/index.tsx"),
			import("../src/tui/app.tsx"),
			import("../src/tui/components/task-list.tsx"),
			import("../src/tui/components/task-detail.tsx"),
			import("../src/tui/components/footer.tsx"),
			import("../src/tui/components/confirm-dialog.tsx"),
			import("../src/tui/components/input-dialog.tsx"),
		]);

		expect(runTui).toBeFunction();
		expect(App).toBeFunction();
		expect(TaskList).toBeFunction();
		expect(TaskDetail).toBeFunction();
		expect(Footer).toBeFunction();
		expect(ConfirmDialog).toBeFunction();
		expect(InputDialog).toBeFunction();
	});
});
