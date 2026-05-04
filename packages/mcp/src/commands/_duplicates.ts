export function findFirstDuplicate(values: readonly string[]): string | null {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) return value;
		seen.add(value);
	}
	return null;
}
