import type { AdapterCapabilities, JobError } from "@cuekit/core";
import type { AdapterResult, AgentAdapter } from "./agent-adapter.ts";

export class AdapterRegistry {
	private readonly adapters = new Map<string, AgentAdapter>();

	register(adapter: AgentAdapter): void {
		if (this.adapters.has(adapter.kind)) {
			throw new Error(`defect: adapter '${adapter.kind}' is already registered`);
		}
		this.adapters.set(adapter.kind, adapter);
	}

	get(kind: string): AgentAdapter | null {
		return this.adapters.get(kind) ?? null;
	}

	require(kind: string): AdapterResult<AgentAdapter> {
		const adapter = this.adapters.get(kind);
		if (!adapter) {
			const error: JobError = {
				code: "adapter_not_found",
				message: `no adapter registered for agent_kind '${kind}'`,
				retryable: false,
			};
			return { ok: false, error };
		}
		return { ok: true, value: adapter };
	}

	list(): AdapterCapabilities[] {
		return [...this.adapters.values()].map((a) => a.capabilities());
	}

	kinds(): string[] {
		return [...this.adapters.keys()];
	}
}
