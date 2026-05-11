import { describe, expect, test } from "bun:test";
import {
	formatHerdrNativeTaskRef,
	parseHerdrNativeTaskRef,
	sanitizeHerdrSessionName,
} from "../src/herdr-coordinate.ts";

describe("herdr coordinates", () => {
	test("formats and parses full herdr native task refs", () => {
		const ref = formatHerdrNativeTaskRef({
			session: "ck-cuekit",
			workspaceId: "w64e95948145ed1",
			tabId: "w64e95948145ed1:1",
			paneId: "w64e95948145ed1-1",
		});
		expect(ref).toBe("herdr:ck-cuekit/w64e95948145ed1/w64e95948145ed1:1/w64e95948145ed1-1");
		expect(parseHerdrNativeTaskRef(ref)).toEqual({
			session: "ck-cuekit",
			workspaceId: "w64e95948145ed1",
			tabId: "w64e95948145ed1:1",
			paneId: "w64e95948145ed1-1",
		});
	});

	test("rejects malformed or non-herdr native refs", () => {
		expect(parseHerdrNativeTaskRef("tmux:%1")).toBeNull();
		expect(parseHerdrNativeTaskRef("herdr:missing/pieces")).toBeNull();
		expect(parseHerdrNativeTaskRef("herdr:default/w/t/p")).toBeNull();
	});

	test("sanitizes herdr session names and avoids reserved default", () => {
		expect(sanitizeHerdrSessionName("cuekit repo/main")).toBe("cuekit-repo-main");
		expect(sanitizeHerdrSessionName("default")).toBe("ck-default");
	});
});
