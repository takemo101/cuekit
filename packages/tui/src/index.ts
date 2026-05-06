import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";
import { App } from "./app.tsx";
import { runAttachArgs } from "./attach.ts";
import type { TuiContext } from "./context.ts";
import type { TuiExit, TuiReturnState } from "./tui-state.ts";

export function printTuiHelp(): void {
	process.stdout.write(`cuekit tui — interactive task cockpit

Usage: cuekit tui

Keys: ↑/↓ select, r refresh, a attach (returns after detach), t teams/tasks, s steer, c cancel, d delete, q quit
`);
}

export async function runTui(ctx: TuiContext, initialState?: TuiReturnState): Promise<TuiExit> {
	const renderer = await createCliRenderer({ exitOnCtrlC: true });
	const root = createRoot(renderer);
	let destroyed = false;
	let exit: TuiExit = { kind: "quit" };
	const destroyedPromise = new Promise<void>((resolve) => {
		renderer.on("destroy", () => {
			destroyed = true;
			root.unmount();
			resolve();
		});
	});

	try {
		root.render(
			createElement(App, {
				ctx,
				initialState,
				onExit: (next: TuiExit) => {
					exit = next;
				},
			}),
		);
		await destroyedPromise;
		return exit;
	} catch (err) {
		if (!destroyed && !renderer.isDestroyed) renderer.destroy();
		throw err;
	}
}

export async function runTuiLoop(ctx: TuiContext): Promise<void> {
	let state: TuiReturnState | undefined;
	while (true) {
		const exit = await runTui(ctx, state);
		if (exit.kind === "quit") return;
		state = exit.returnState;
		const exitCode = await runAttachArgs(exit.args);
		if (exitCode !== 0) process.exitCode = exitCode;
	}
}
