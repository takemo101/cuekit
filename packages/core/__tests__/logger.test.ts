import { describe, expect, it } from "bun:test";
import { createStderrLogger, type Logger, parseLogLevel, silentLogger } from "../src/logger.ts";

// Deterministic timestamp for format assertions.
const FIXED_TS = "2026-04-24T08:30:00.000Z";
function makeLogger(extra: Parameters<typeof createStderrLogger>[0] = {}) {
	const captured: string[] = [];
	const logger = createStderrLogger({
		write: (s) => captured.push(s),
		now: () => FIXED_TS,
		...extra,
	});
	return { logger, captured };
}

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

describe("parseLogLevel", () => {
	it("accepts known levels verbatim", () => {
		expect(parseLogLevel("debug")).toBe("debug");
		expect(parseLogLevel("info")).toBe("info");
		expect(parseLogLevel("warn")).toBe("warn");
		expect(parseLogLevel("error")).toBe("error");
	});

	it("falls back to 'warn' for undefined", () => {
		expect(parseLogLevel(undefined)).toBe("warn");
	});

	it("falls back to the given default for unknown values (no silent footgun)", () => {
		expect(parseLogLevel("verbose")).toBe("warn");
		expect(parseLogLevel("")).toBe("warn");
		expect(parseLogLevel("FATAL")).toBe("warn"); // case-sensitive
		expect(parseLogLevel("verbose", "info")).toBe("info");
	});
});

describe("createStderrLogger", () => {
	it("writes warn and error by default, drops debug and info", () => {
		const { logger, captured } = makeLogger();
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
		const { logger, captured } = makeLogger({ minLevel: "debug" });
		logger.debug("dbg");
		logger.info("inf");
		expect(captured.join("")).toContain("dbg");
		expect(captured.join("")).toContain("inf");
	});

	it("formats entries as 'cuekit <ts> [level] message'", () => {
		const { logger, captured } = makeLogger();
		logger.warn("hello");
		expect(captured.join("")).toBe(`cuekit ${FIXED_TS} [warn] hello\n`);
	});

	it("appends JSON-serialized context when provided", () => {
		const { logger, captured } = makeLogger();
		logger.error("boom", { task_id: "t1", code: 42 });
		const out = captured.join("");
		expect(out).toContain("boom");
		expect(out).toContain('"task_id":"t1"');
		expect(out).toContain('"code":42');
	});

	it("keeps higher levels when a lower minLevel is chosen", () => {
		const { logger, captured } = makeLogger({ minLevel: "error" });
		logger.warn("dropped");
		logger.error("kept");
		const out = captured.join("");
		expect(out).not.toContain("dropped");
		expect(out).toContain("kept");
	});

	it("expands Error objects into { name, message, cause? } instead of '{}'", () => {
		const { logger, captured } = makeLogger();
		const err = new Error("boom");
		logger.error("caught", { err });
		const out = captured.join("");
		// Default JSON.stringify(new Error("boom")) is "{}" — we use a
		// replacer so the reason actually shows up in logs.
		expect(out).toContain('"message":"boom"');
		expect(out).toContain('"name":"Error"');
		expect(out).not.toContain('"err":{}');
	});

	it("preserves Error.cause when present (nested error chains)", () => {
		const { logger, captured } = makeLogger();
		const cause = new Error("root");
		const wrap = new Error("outer", { cause });
		logger.error("wrapped", { err: wrap });
		const out = captured.join("");
		expect(out).toContain('"message":"outer"');
		expect(out).toContain("root");
	});

	it("does not crash on circular context (safe stringify)", () => {
		const { logger, captured } = makeLogger();
		const circular: Record<string, unknown> = { a: 1 };
		circular.self = circular;
		expect(() => logger.warn("circular", circular)).not.toThrow();
		const out = captured.join("");
		expect(out).toContain("[unserializable context]");
	});

	it("swallows write-sink failures instead of crashing the caller", () => {
		const logger = createStderrLogger({
			write: () => {
				throw new Error("stderr closed");
			},
			now: () => FIXED_TS,
		});
		expect(() => logger.error("boom")).not.toThrow();
	});

	it("prepends an ISO-8601 timestamp", () => {
		const { logger, captured } = makeLogger();
		logger.warn("x");
		expect(captured.join("")).toMatch(
			/^cuekit \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[warn\] x\n$/,
		);
	});
});
