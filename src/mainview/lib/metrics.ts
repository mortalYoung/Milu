import { createStore } from "solid-js/store";
import type { ContextSnapshot, SessionStats } from "../../shared/rpc";
import type { RPC } from "./rpc";

export interface MetricsData {
	contextUsage: ContextSnapshot | null;
	stats: SessionStats | null;
}

export function createMetrics(rpc: RPC) {
	const [data, setData] = createStore<MetricsData>({
		contextUsage: null,
		stats: null,
	});

	const mutate = async (name: string | null) => {
		if (!name) {
			setData({ contextUsage: null, stats: null });
			return;
		}
		const [contextUsage, stats] = await Promise.all([rpc.request.context_usage({ name }), rpc.request.stats({ name })]);
		setData({ contextUsage, stats });
	};

	return { data, mutate };
}
