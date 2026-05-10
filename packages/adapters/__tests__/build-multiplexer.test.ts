import { describe, expect, it } from "bun:test";
import { buildMultiplexerBackend } from "../src/build-multiplexer.ts";

describe("buildMultiplexerBackend", () => {
	it("returns tmux when no config and tmux probes ok", async () => {
		const result = await buildMultiplexerBackend(undefined, {
			probe: { tmux: true },
		});
		expect(result.requested).toBe("tmux");
		expect(result.fallbackApplied).toBe(false);
		expect(result.backend.kind).toBe("tmux");
	});

	it("returns tmux when explicitly configured and tmux probes ok", async () => {
		const result = await buildMultiplexerBackend(
			{ multiplexer: "tmux" },
			{ probe: { tmux: true } },
		);
		expect(result.requested).toBe("tmux");
		expect(result.backend.kind).toBe("tmux");
	});

	it("returns zellij when configured and zellij probes ok", async () => {
		const result = await buildMultiplexerBackend(
			{ multiplexer: "zellij" },
			{ probe: { zellij: true } },
		);
		expect(result.requested).toBe("zellij");
		expect(result.fallbackApplied).toBe(false);
		expect(result.backend.kind).toBe("zellij");
	});

	it("falls back to tmux when zellij is configured but its probe fails", async () => {
		const warnings: string[] = [];
		const result = await buildMultiplexerBackend(
			{ multiplexer: "zellij" },
			{
				probe: { zellij: false, tmux: true },
				logger: {
					debug: () => {},
					info: () => {},
					warn: (msg: unknown) => warnings.push(String(msg)),
					error: () => {},
				},
			},
		);
		expect(result.requested).toBe("zellij");
		expect(result.fallbackApplied).toBe(true);
		expect(result.backend.kind).toBe("tmux");
		expect(warnings.some((w) => w.includes("falling back to tmux"))).toBe(true);
	});

	it("hard-fails when zellij probe fails and multiplexer_strict is true", async () => {
		await expect(
			buildMultiplexerBackend(
				{ multiplexer: "zellij", multiplexer_strict: true },
				{ probe: { zellij: false } },
			),
		).rejects.toThrow(/multiplexer_strict.*zellij.*failed/i);
	});

	it("hard-fails when both zellij and tmux probes fail", async () => {
		await expect(
			buildMultiplexerBackend(
				{ multiplexer: "zellij" },
				{ probe: { zellij: false, tmux: false } },
			),
		).rejects.toThrow(/probe failed.*tmux fallback also failed/i);
	});

	it("hard-fails when tmux is configured and its probe fails (no further fallback)", async () => {
		await expect(
			buildMultiplexerBackend({ multiplexer: "tmux" }, { probe: { tmux: false } }),
		).rejects.toThrow(/tmux.*failed/);
	});
});
