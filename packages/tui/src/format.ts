export function truncateEnd(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function truncateMiddle(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	if (maxLength <= 3) return value.slice(0, maxLength);
	const keep = maxLength - 3;
	const start = Math.ceil(keep / 2);
	const end = Math.floor(keep / 2);
	return `${value.slice(0, start)}...${value.slice(value.length - end)}`;
}
