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

const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

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

// Validates that `raw` names a known log level. Unknown / undefined values
// fall back to `fallback` (default "warn") so a typo in CUEKIT_LOG_LEVEL
// doesn't silently enable debug-level emit-everything behaviour.
export function parseLogLevel(raw: string | undefined, fallback: LogLevel = "warn"): LogLevel {
	if (raw === undefined) return fallback;
	return (LEVELS as readonly string[]).includes(raw) ? (raw as LogLevel) : fallback;
}

export interface CreateStderrLoggerOptions {
	// Messages with a level lower than this are dropped. Default "warn".
	minLevel?: LogLevel;
	// Override sink — mainly for tests that want to capture output without
	// touching real stderr. Default: `process.stderr.write`.
	write?: (chunk: string) => void;
	// Override timestamp source. Mainly for deterministic test output.
	// Default: `() => new Date().toISOString()`.
	now?: () => string;
}

// Factory for a stderr-backed logger used by the `cuekit` binary. Entries
// format as `cuekit <ISO-8601> [level] message {context}` so they tee
// nicely with the child-runtime's own output when it runs in a tmux pane.
export function createStderrLogger(options: CreateStderrLoggerOptions = {}): Logger {
	const minLevel = options.minLevel ?? "warn";
	const minRank = LEVEL_ORDER[minLevel];
	const write = options.write ?? ((chunk: string) => process.stderr.write(chunk));
	const now = options.now ?? (() => new Date().toISOString());

	function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
		if (LEVEL_ORDER[level] < minRank) return;
		const ctxStr = context !== undefined ? ` ${safeStringify(context)}` : "";
		try {
			write(`cuekit ${now()} [${level}] ${message}${ctxStr}\n`);
		} catch {
			// Logging must never crash the caller. If the write sink dies we
			// silently drop — the alternative is breaking whatever triggered
			// the log.
		}
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

// JSON.stringify wrapper that:
//   • expands Error into { name, message, cause? } so logging `{ err }`
//     produces something useful instead of the `{}` JSON.stringify default
//     for Error (its properties are non-enumerable).
//   • swallows serialization failures (circular refs, BigInt, etc.) so
//     the caller's app never crashes from a log call.
function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, (_key, val) => {
			if (val instanceof Error) {
				const out: Record<string, unknown> = {
					name: val.name,
					message: val.message,
				};
				if (val.cause !== undefined) out.cause = val.cause;
				return out;
			}
			return val;
		});
	} catch {
		return "[unserializable context]";
	}
}
