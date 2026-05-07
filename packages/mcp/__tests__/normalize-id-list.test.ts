import { describe, expect, it } from "bun:test";
import { normalizeIdList } from "../src/commands/_normalize-id-list.ts";

describe("normalizeIdList", () => {
	it("returns the repeat-flag form unchanged", () => {
		expect(normalizeIdList(["t_a", "t_b"])).toEqual(["t_a", "t_b"]);
	});

	it("splits comma-separated values into individual ids", () => {
		expect(normalizeIdList(["t_a,t_b"])).toEqual(["t_a", "t_b"]);
	});

	it("supports a mix of repeat-flag and comma forms", () => {
		expect(normalizeIdList(["t_a", "t_b,t_c", "t_d"])).toEqual(["t_a", "t_b", "t_c", "t_d"]);
	});

	it("trims whitespace around ids", () => {
		expect(normalizeIdList(["t_a, t_b , t_c"])).toEqual(["t_a", "t_b", "t_c"]);
	});

	it("drops empty fragments from leading/trailing/consecutive commas", () => {
		expect(normalizeIdList([",t_a,"])).toEqual(["t_a"]);
		expect(normalizeIdList(["t_a,,t_b"])).toEqual(["t_a", "t_b"]);
		expect(normalizeIdList(["  ,  "])).toEqual([]);
	});

	it("returns an empty array for an empty input", () => {
		expect(normalizeIdList([])).toEqual([]);
	});

	it("preserves duplicate ids so callers can detect them downstream", () => {
		expect(normalizeIdList(["t_a,t_a"])).toEqual(["t_a", "t_a"]);
	});
});
