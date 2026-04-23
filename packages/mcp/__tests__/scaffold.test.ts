import { describe, expect, it } from "bun:test";

describe("@cuekit/mcp scaffold", () => {
	it("loads the package entry", async () => {
		const mod = await import("../src/index.ts");
		expect(mod).toBeDefined();
	});
});
