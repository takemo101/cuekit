import {
	type AgentProfileFile,
	AgentProfileFileSchema,
	type AgentProfileSource,
} from "./schema.ts";

export interface ParseAgentProfileMarkdownInput {
	content: string;
	source: AgentProfileSource;
	filePath?: string;
}

export type ParseAgentProfileMarkdownResult =
	| { ok: true; profile: AgentProfileFile }
	| { ok: false; error: string };

function unquote(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseValue(key: string, raw: string): string | string[] {
	const value = unquote(raw);
	if (key !== "tags" || !value.includes(",")) return value;
	return value
		.split(",")
		.map((item) => unquote(item))
		.filter((item) => item.length > 0);
}

function parseFrontmatterBlock(block: string): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	let listKey: string | undefined;
	for (const line of block.split("\n")) {
		if (line.trim().length === 0) continue;
		const listItem = line.match(/^\s*-\s*(.*)$/);
		if (listItem && listKey) {
			const current = Array.isArray(fields[listKey]) ? fields[listKey] : [];
			fields[listKey] = [...(current as string[]), unquote(listItem[1] ?? "")].filter(
				(item) => item.length > 0,
			);
			continue;
		}
		const match = line.match(/^([\w-]+):\s*(.*)$/);
		if (!match) continue;
		const key = match[1] ?? "";
		const rawValue = match[2] ?? "";
		listKey = rawValue.trim().length === 0 ? key : undefined;
		fields[key] = rawValue.trim().length === 0 ? [] : parseValue(key, rawValue);
	}
	return fields;
}

export function parseAgentProfileMarkdown(
	input: ParseAgentProfileMarkdownInput,
): ParseAgentProfileMarkdownResult {
	const normalized = input.content.replace(/\r\n/g, "\n");
	let frontmatter: Record<string, unknown> = {};
	let body = normalized.trim();
	if (normalized.startsWith("---\n")) {
		const endIndex = normalized.indexOf("\n---", 4);
		if (endIndex === -1) {
			return { ok: false, error: "unterminated frontmatter" };
		}
		frontmatter = parseFrontmatterBlock(normalized.slice(4, endIndex));
		body = normalized.slice(endIndex + 4).trim();
	}
	const parsed = AgentProfileFileSchema.safeParse({
		...frontmatter,
		instructions: body,
		source: input.source,
		...(input.filePath ? { file_path: input.filePath } : {}),
	});
	if (!parsed.success) {
		return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
	}
	return { ok: true, profile: parsed.data };
}
