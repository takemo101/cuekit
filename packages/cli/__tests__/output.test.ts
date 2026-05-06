import { describe, expect, it } from "bun:test";
import { formatCheckLine, formatCommandBlock } from "../src/output.ts";

describe("CLI output helpers", () => {
	it("formats status check lines consistently", () => {
		expect(formatCheckLine({ level: "ok", label: "bun", detail: "1.2.0" })).toBe("✓ bun: 1.2.0");
		expect(formatCheckLine({ level: "warn", label: "update", detail: "v0.1.1 available" })).toBe(
			"! update: v0.1.1 available",
		);
		expect(formatCheckLine({ level: "fail", label: "tmux", detail: "not found" })).toBe(
			"✗ tmux: not found",
		);
	});

	it("formats command blocks with indentation", () => {
		expect(formatCommandBlock("Run", "bun install -g github:takemo101/cuekit#v0.1.1")).toBe(
			"Run:\n\n  bun install -g github:takemo101/cuekit#v0.1.1\n",
		);
	});
});
