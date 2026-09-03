import { createResource } from "solid-js";
import type { ContextSnapshot, SessionStats } from "../../shared/rpc";
import type { RPC } from "./rpc";
import { useSession } from "./session-context";

export interface MetricsData {
	contextUsage: ContextSnapshot | null;
	stats: SessionStats | null;
}

export function createMetrics(rpc: RPC) {
	const { data: sessionData } = useSession();
	const [data, { refetch }] = createResource(
		() => [sessionData.selected, sessionData.origin.total] as const,
		async () => {
			const name = sessionData.selected;
			if (!name) return { contextUsage: null, stats: null };
			const [contextUsage, stats] = await Promise.all([rpc.request.context_usage({ name }), rpc.request.stats({ name })]);
			return { contextUsage, stats };
		},
	);

	rpc.addMessageListener("agent_end", () => refetch());
	rpc.addMessageListener("trajectory_update", () => refetch());
	rpc.addMessageListener("command_update", () => refetch());

	return { data };
}
