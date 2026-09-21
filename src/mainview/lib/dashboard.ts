import { createStore } from "zustand/vanilla";
import type { RPC } from "./rpc";

export function createDashboard(rpc: RPC) {
	const store = createStore<{ overview: Awaited<ReturnType<typeof rpc.request.dashboard_overview>>["overview"] | null; asOf: number | null; days: number; loading: boolean }>()(
		() => ({
			overview: null,
			asOf: null,
			days: 7,
			loading: false,
		}),
	);
	let seq = 0;

	async function refresh() {
		const token = ++seq;
		const days = store.getState().days;
		store.setState({ loading: true });
		try {
			const result = await rpc.request.dashboard_overview({ days });
			if (token !== seq) return;
			store.setState({ overview: result.overview, asOf: Date.now() });
		} finally {
			if (token === seq) store.setState({ loading: false });
		}
	}

	function setDays(days: number) {
		if (store.getState().days === days) return;
		store.setState({ days });
		void refresh();
	}

	function install() {
		rpc.addMessageListener("agent_end", () => void refresh());
	}

	return { store, refresh, setDays, install };
}

export type Dashboard = ReturnType<typeof createDashboard>;
