// POSIX single-quote escape for values embedded in a shell command string
// (tmux launch commands, pipe-pane redirections, etc.). Wraps the whole
// value in single quotes, escaping any embedded single quote via the
// standard `'\''` pattern.
export function shellQuote(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}
