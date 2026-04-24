// Keyset-pagination cursor for `listTasks`. Kept opaque at the MCP
// boundary — callers pass back exactly the `next_cursor` string they
// received, never hand-craft it. Encoding is a base64url JSON envelope
// so we can extend the shape later without breaking existing clients.

export interface TaskListCursor {
	// Last row's `updated_at` on the page being anchored to.
	updated_at: string;
	// Last row's `id` — tiebreaker when multiple rows share the same
	// `updated_at` (ms-precision ISO strings collide under rapid inserts).
	id: string;
}

export function encodeTaskListCursor(cursor: TaskListCursor): string {
	const json = JSON.stringify({ u: cursor.updated_at, i: cursor.id });
	return Buffer.from(json, "utf8").toString("base64url");
}

// Throws if the cursor is malformed. Callers at the MCP boundary should
// translate the thrown Error into a structured `invalid_input` error so
// the client sees a protocol-level failure rather than a 500.
export function decodeTaskListCursor(cursor: string): TaskListCursor {
	let json: string;
	try {
		json = Buffer.from(cursor, "base64url").toString("utf8");
	} catch {
		throw new Error(`invalid cursor: not base64url`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error(`invalid cursor: not JSON`);
	}
	if (
		parsed === null ||
		typeof parsed !== "object" ||
		typeof (parsed as { u?: unknown }).u !== "string" ||
		typeof (parsed as { i?: unknown }).i !== "string"
	) {
		throw new Error(`invalid cursor: missing fields`);
	}
	return {
		updated_at: (parsed as { u: string }).u,
		id: (parsed as { i: string }).i,
	};
}
