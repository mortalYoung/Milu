import { createSignal } from "solid-js";
import type { ContextUsage, SessionStats } from "../../shared/rpc";
import type { RPC } from "./rpc";

/** Session usage totals + timing stats for the composer meter. */
export function createMetrics(rpc: RPC) {
	const [contextUsage, setContextUsage] = createSignal<ContextUsage | null>(null);
	const [stats, setStats] = createSignal<SessionStats | null>(null);

	async function refresh() {
		const [usage, s] = await Promise.all([rpc.request.context_usage({}), rpc.request.stats({})]);
		setContextUsage(usage);
		setStats(s);
	}

	return { contextUsage, stats, refresh };
}
