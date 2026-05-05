export const TASK_DIAGNOSTIC_KINDS = ["timeout", "stale", "pane_disappeared"] as const;

export type TaskDiagnosticKind = (typeof TASK_DIAGNOSTIC_KINDS)[number];

export interface TaskObservabilityPayload {
	phase?: string;
	files?: {
		read?: string[];
		written?: string[];
	};
	diagnostic?: {
		kind: TaskDiagnosticKind;
		message?: string;
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDiagnosticKind(value: unknown): value is TaskDiagnosticKind {
	return typeof value === "string" && TASK_DIAGNOSTIC_KINDS.includes(value as TaskDiagnosticKind);
}

function normalizeStringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const seen = new Set<string>();
	const result: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") continue;
		const trimmed = entry.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result.length > 0 ? result : undefined;
}

function appendUnique(target: string[], values: string[] | undefined): void {
	if (!values) return;
	const seen = new Set(target);
	for (const value of values) {
		if (seen.has(value)) continue;
		seen.add(value);
		target.push(value);
	}
}

export function parseTaskObservabilityPayload(payload: unknown): TaskObservabilityPayload | null {
	if (!isRecord(payload)) return null;

	const parsed: TaskObservabilityPayload = {};

	if (typeof payload.phase === "string" && payload.phase.trim()) {
		parsed.phase = payload.phase.trim();
	}

	if (isRecord(payload.files)) {
		const read = normalizeStringList(payload.files.read);
		const written = normalizeStringList(payload.files.written);
		if (read || written) {
			parsed.files = {
				...(read ? { read } : {}),
				...(written ? { written } : {}),
			};
		}
	}

	if (isRecord(payload.diagnostic) && isDiagnosticKind(payload.diagnostic.kind)) {
		const message =
			typeof payload.diagnostic.message === "string" && payload.diagnostic.message.trim()
				? payload.diagnostic.message.trim()
				: undefined;
		parsed.diagnostic = {
			kind: payload.diagnostic.kind,
			...(message ? { message } : {}),
		};
	}

	return parsed.phase || parsed.files || parsed.diagnostic ? parsed : null;
}

export function observedFilesFromPayloads(payloads: unknown[]): {
	read: string[];
	written: string[];
} {
	const read: string[] = [];
	const written: string[] = [];
	for (const payload of payloads) {
		const parsed = parseTaskObservabilityPayload(payload);
		appendUnique(read, parsed?.files?.read);
		appendUnique(written, parsed?.files?.written);
	}
	return { read, written };
}

export function diagnosticsFromPayloads(
	payloads: unknown[],
): Array<{ kind: TaskDiagnosticKind; message?: string }> {
	const diagnostics: Array<{ kind: TaskDiagnosticKind; message?: string }> = [];
	for (const payload of payloads) {
		const diagnostic = parseTaskObservabilityPayload(payload)?.diagnostic;
		if (diagnostic) diagnostics.push(diagnostic);
	}
	return diagnostics;
}

export function intersectObservedFiles(read: string[], written: string[]): string[] {
	const writtenSet = new Set(written);
	const seen = new Set<string>();
	const result: string[] = [];
	for (const path of read) {
		if (!writtenSet.has(path) || seen.has(path)) continue;
		seen.add(path);
		result.push(path);
	}
	return result;
}
