export interface HerdrCoordinate {
	session: string;
	workspaceId: string;
	tabId: string;
	paneId: string;
}

const HERDR_REF_PREFIX = "herdr:";
const RESERVED_SESSION_NAMES = new Set(["default"]);

export function sanitizeHerdrSessionName(value: string): string {
	const sanitized = value
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[.-]+|[.-]+$/g, "");
	const fallback = sanitized.length > 0 ? sanitized : "ck";
	return RESERVED_SESSION_NAMES.has(fallback) ? `ck-${fallback}` : fallback;
}

export function formatHerdrNativeTaskRef(coordinate: HerdrCoordinate): string {
	return `${HERDR_REF_PREFIX}${coordinate.session}/${coordinate.workspaceId}/${coordinate.tabId}/${coordinate.paneId}`;
}

export function formatHerdrBackendPaneId(coordinate: Omit<HerdrCoordinate, "session">): string {
	return `${coordinate.workspaceId}/${coordinate.tabId}/${coordinate.paneId}`;
}

export function parseHerdrNativeTaskRef(ref: string | null | undefined): HerdrCoordinate | null {
	if (!ref?.startsWith(HERDR_REF_PREFIX)) return null;
	return parseHerdrCoordinate(ref.slice(HERDR_REF_PREFIX.length));
}

export function parseHerdrBackendPaneId(
	session: string | undefined,
	backendPaneId: string | undefined,
): HerdrCoordinate | null {
	if (!session || !backendPaneId) return null;
	return parseHerdrCoordinate(`${session}/${backendPaneId}`);
}

function parseHerdrCoordinate(value: string): HerdrCoordinate | null {
	const parts = value.split("/");
	if (parts.length !== 4) return null;
	const [session, workspaceId, tabId, paneId] = parts;
	if (!session || !workspaceId || !tabId || !paneId) return null;
	if (RESERVED_SESSION_NAMES.has(session)) return null;
	return { session, workspaceId, tabId, paneId };
}
