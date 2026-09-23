import { createStore, type StoreApi } from "zustand/vanilla";
import type { ContextSnapshot } from "../../shared/rpc";
import type { RPC } from "./rpc";
import type { SessionData } from "./session";

export interface MetricsData {
	contextUsage: ContextSnapshot | null;
}

export function createMetrics(rpc: RPC, session: StoreApi<SessionData>) {
	const store = createStore<{ data: MetricsData | null }>()(() => ({ data: null }));
	let refreshSeq = 0;

	async function refresh() {
		const name = session.getState().selected;
		if (!name) {
			store.setState({ data: { contextUsage: null } });
			return;
		}
		const seq = ++refreshSeq;
		const contextUsage = await rpc.request.context_usage({ name });
		if (seq !== refreshSeq) return;
		store.setState({ data: { contextUsage } });
	}

	function install() {
		session.subscribe((state, previous) => {
			if (state.selected !== previous.selected || state.origin.total !== previous.origin.total) void refresh();
		});
		rpc.addMessageListener("agent_end", ({ partner }) => {
			if (partner === session.getState().selected) void refresh();
		});
		rpc.addMessageListener("origin_update", ({ partner }) => {
			if (partner === session.getState().selected) void refresh();
		});
		rpc.addMessageListener("command_update", () => void refresh());
	}

	return { store, refresh, install };
}
