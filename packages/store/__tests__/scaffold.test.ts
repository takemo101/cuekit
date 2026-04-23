import { describe, expect, it } from "bun:test";

describe("@cuekit/store scaffold", () => {
	it("loads the package entry", async () => {
		const mod = await import("../src/index.ts");
		expect(mod).toBeDefined();
	});
});
