import { createResource } from "solid-js";
import type { ContextSnapshot, SessionStats } from "../../shared/rpc";
import { useSession } from "./contexts/session-context";
import type { RPC } from "./rpc";

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

	rpc.addMessageListener("agent_end", ({ partner }) => {
		if (partner === sessionData.selected) refetch();
	});
	rpc.addMessageListener("origin_update", ({ partner }) => {
		if (partner === sessionData.selected) refetch();
	});
	rpc.addMessageListener("command_update", () => refetch());

	return { data };
}
