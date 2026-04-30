import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";
import { App } from "./app.tsx";
import type { TuiContext } from "./context.ts";

export function printTuiHelp(): void {
	process.stdout.write(`cuekit tui — interactive task cockpit

Usage: cuekit tui

Keys: ↑/↓ select, r refresh, a attach, s steer, c cancel, d delete, q quit
`);
}

export async function runTui(ctx: TuiContext): Promise<void> {
	const renderer = await createCliRenderer({ exitOnCtrlC: true });
	const root = createRoot(renderer);
	let destroyed = false;
	let attachArgs: string[] | undefined;
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
				onAttach: (args: string[]) => {
					attachArgs = args;
				},
			}),
		);
		await destroyedPromise;
		if (attachArgs) {
			const proc = Bun.spawn(attachArgs, {
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			});
			const exitCode = await proc.exited;
			if (exitCode !== 0) process.exitCode = exitCode;
		}
	} catch (err) {
		if (!destroyed && !renderer.isDestroyed) renderer.destroy();
		throw err;
	}
}
