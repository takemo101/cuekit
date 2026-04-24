import { describe, expect, it } from "bun:test";
import { createStderrLogger, type Logger, silentLogger } from "../src/logger.ts";

describe("silentLogger", () => {
	it("accepts all level calls without throwing or writing", () => {
		// Pure no-op smoke test — if the interface drifts this stops type-checking.
		const l: Logger = silentLogger;
		l.debug("x");
		l.info("x");
		l.warn("x");
		l.error("x", { extra: 1 });
		expect(true).toBe(true);
	});
});

describe("createStderrLogger", () => {
	it("writes warn and error by default, drops debug and info", () => {
		const captured: string[] = [];
		const logger = createStderrLogger({ write: (s) => captured.push(s) });
		logger.debug("dbg");
		logger.info("inf");
		logger.warn("wrn");
		logger.error("err");
		const out = captured.join("");
		expect(out).not.toContain("dbg");
		expect(out).not.toContain("inf");
		expect(out).toContain("wrn");
		expect(out).toContain("err");
	});

	it("respects a custom minLevel", () => {
		const captured: string[] = [];
		const logger = createStderrLogger({
			minLevel: "debug",
			write: (s) => captured.push(s),
		});
		logger.debug("dbg");
		logger.info("inf");
		const out = captured.join("");
		expect(out).toContain("dbg");
		expect(out).toContain("inf");
	});

	it("formats entries as 'cuekit [level] message'", () => {
		const captured: string[] = [];
		const logger = createStderrLogger({ write: (s) => captured.push(s) });
		logger.warn("hello");
		expect(captured.join("")).toBe("cuekit [warn] hello\n");
	});

	it("appends JSON-serialized context when provided", () => {
		const captured: string[] = [];
		const logger = createStderrLogger({ write: (s) => captured.push(s) });
		logger.error("boom", { task_id: "t1", code: 42 });
		const out = captured.join("");
		expect(out).toContain("boom");
		expect(out).toContain('"task_id":"t1"');
		expect(out).toContain('"code":42');
	});

	it("keeps higher levels when a lower minLevel is chosen", () => {
		// minLevel: 'error' drops debug/info/warn but keeps error.
		const captured: string[] = [];
		const logger = createStderrLogger({
			minLevel: "error",
			write: (s) => captured.push(s),
		});
		logger.warn("dropped");
		logger.error("kept");
		const out = captured.join("");
		expect(out).not.toContain("dropped");
		expect(out).toContain("kept");
	});
});
