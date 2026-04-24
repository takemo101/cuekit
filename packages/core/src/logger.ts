// Minimal structured logger contract. cuekit avoids a log library dep by
// keeping the surface small — four level-named methods with an optional
// structured context. Callers choose where logs go (stderr, a collector,
// nowhere); library code never writes to stderr / stdout directly.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
	debug(message: string, context?: Record<string, unknown>): void;
	info(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	error(message: string, context?: Record<string, unknown>): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

// Default for tests and library consumers who want no log output.
export const silentLogger: Logger = {
	debug() {},
	info() {},
	warn() {},
	error() {},
};

export interface CreateStderrLoggerOptions {
	// Messages with a level lower than this are dropped. Default "warn".
	minLevel?: LogLevel;
	// Override sink — mainly for tests that want to capture output without
	// touching real stderr. Default: `process.stderr.write`.
	write?: (chunk: string) => void;
}

// Factory for a stderr-backed logger used by the `cuekit` binary. Entries
// format as `cuekit [level] message {context}` so they tee nicely with
// the child-runtime's own output when it runs in a tmux pane.
export function createStderrLogger(options: CreateStderrLoggerOptions = {}): Logger {
	const minLevel = options.minLevel ?? "warn";
	const minRank = LEVEL_ORDER[minLevel];
	const write = options.write ?? ((chunk: string) => process.stderr.write(chunk));

	function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
		if (LEVEL_ORDER[level] < minRank) return;
		const ctxStr = context !== undefined ? ` ${JSON.stringify(context)}` : "";
		write(`cuekit [${level}] ${message}${ctxStr}\n`);
	}

	return {
		debug(message, context) {
			emit("debug", message, context);
		},
		info(message, context) {
			emit("info", message, context);
		},
		warn(message, context) {
			emit("warn", message, context);
		},
		error(message, context) {
			emit("error", message, context);
		},
	};
}
