import type { Logger } from "@cuekit/core";
import type { MultiplexerBackend } from "./multiplexer-backend.ts";

/**
 * Minimal subset of CuekitProjectConfig the factory cares about. Avoids a
 * dependency from @cuekit/adapters on @cuekit/project-config — callers
 * (CLI, MCP) load the full config themselves and pass the slice they
 * already have.
 */
export interface MultiplexerConfigSlice {
	multiplexer?: "tmux" | "zellij" | { backend?: "tmux" | "zellij"; strict?: boolean };
	multiplexer_strict?: boolean;
}

import { TmuxBackend } from "./tmux-backend.ts";
import { ZellijBackend } from "./zellij-backend.ts";

/**
 * Resolve and construct the multiplexer backend a cuekit process should use.
 *
 * Selection rules (see `docs/designs/cuekit-multiplexer-backend-design.md`):
 *
 *   1. Read `multiplexer.backend` from the project config (default: tmux).
 *   2. Probe the requested backend.
 *   3. If the probe fails:
 *        - When `multiplexer.strict: true` is set in the config → throw.
 *        - Otherwise → fall back to tmux and emit a one-time warning.
 *   4. If the requested backend is tmux and its probe fails, throw
 *      regardless of strict mode (tmux is the baseline; there's no
 *      lower-level backend to fall back to).
 *
 * The factory is the single source of truth for the active backend so
 * that `cuekit doctor`, the MCP server, and the human CLI/TUI all see
 * the same value.
 */
export interface BuildMultiplexerOptions {
	logger?: Logger;
	// Test injection seam — pass `false` to short-circuit the relevant
	// probe without spawning the actual binary.
	probe?: {
		tmux?: boolean;
		zellij?: boolean;
	};
}

export interface BuiltMultiplexer {
	backend: MultiplexerBackend;
	requested: "tmux" | "zellij";
	fallbackApplied: boolean;
}

export async function buildMultiplexerBackend(
	config: MultiplexerConfigSlice | undefined,
	options: BuildMultiplexerOptions = {},
): Promise<BuiltMultiplexer> {
	const requested = resolveRequestedMultiplexer(config);
	const strict = resolveStrictMode(config);

	if (requested === "tmux") {
		// tmux is the baseline; either it works or cuekit can't function.
		// We probe so doctor / startup get a consistent failure path.
		if (options.probe?.tmux === false || !(await probeBinary("tmux", ["-V"]))) {
			throw new Error(
				"multiplexer 'tmux' is configured but `tmux -V` failed; install tmux or pick another backend",
			);
		}
		return { backend: new TmuxBackend(), requested, fallbackApplied: false };
	}

	if (requested === "zellij") {
		const zellijOk = options.probe?.zellij ?? (await probeBinary("zellij", ["--version"]));
		if (zellijOk) {
			return { backend: new ZellijBackend(), requested, fallbackApplied: false };
		}
		if (strict) {
			throw new Error(
				"multiplexer 'zellij' is configured with strict mode enabled but `zellij --version` failed; install zellij or relax the strict flag",
			);
		}
		// Soft fallback to tmux. tmux must still probe.
		const tmuxOk = options.probe?.tmux ?? (await probeBinary("tmux", ["-V"]));
		if (!tmuxOk) {
			throw new Error(
				"multiplexer 'zellij' probe failed and the tmux fallback also failed; install one of them",
			);
		}
		options.logger?.warn?.(
			"project config requests multiplexer 'zellij' but its probe failed; falling back to tmux. Install zellij or set multiplexer.backend: tmux to silence this warning.",
		);
		return { backend: new TmuxBackend(), requested, fallbackApplied: true };
	}

	throw new Error(`unknown multiplexer '${String(requested)}'`);
}

function resolveRequestedMultiplexer(
	config: MultiplexerConfigSlice | undefined,
): "tmux" | "zellij" {
	const configured = config?.multiplexer;
	if (typeof configured === "string") return configured;
	return configured?.backend ?? "tmux";
}

function resolveStrictMode(config: MultiplexerConfigSlice | undefined): boolean {
	const configured = config?.multiplexer;
	if (typeof configured === "object" && configured !== null && configured.strict !== undefined) {
		return configured.strict;
	}
	return config?.multiplexer_strict === true;
}

async function probeBinary(command: string, args: string[]): Promise<boolean> {
	try {
		const proc = Bun.spawn([command, ...args], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const exit = await proc.exited;
		return exit === 0;
	} catch {
		return false;
	}
}
