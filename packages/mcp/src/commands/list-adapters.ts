import { AdapterCapabilitiesSchema } from "@cuekit/core";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

export const ListAdaptersInputSchema = z.object({});

export type ListAdaptersInput = z.infer<typeof ListAdaptersInputSchema>;

export const ListAdaptersOutputSchema = z.object({
	adapters: z.array(AdapterCapabilitiesSchema),
});

export type ListAdaptersOutput = z.infer<typeof ListAdaptersOutputSchema>;

export async function runListAdapters(
	ctx: CommandContext,
	_input: ListAdaptersInput,
): Promise<ListAdaptersOutput> {
	return { adapters: ctx.registry.list() };
}
