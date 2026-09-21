import { createStore, type StoreApi } from "zustand/vanilla";
import type { RPC } from "./rpc";
import type { SessionData } from "./session";

export function createUnread(rpc: RPC, session: StoreApi<SessionData>) {
	const store = createStore<{ readAt: Record<string, number> }>()(() => ({ readAt: {} }));

	function syncWatermarks() {
		const { partners } = session.getState();
		const current = store.getState().readAt;
		let next: Record<string, number> | null = null;
		for (const partner of partners) {
			if (partner.readAt == null) continue;
			if (partner.readAt <= ((next ?? current)[partner.name] ?? 0)) continue;
			next ??= { ...current };
			next[partner.name] = partner.readAt;
		}
		if (next) store.setState({ readAt: next });
	}

	function markSelectedRead() {
		const { selected, partners } = session.getState();
		if (!selected) return;
		const latest = partners.find((p) => p.name === selected)?.lastMessageAt;
		if (latest == null) return;
		if (latest <= (store.getState().readAt[selected] ?? 0)) return;
		store.setState((state) => ({ readAt: { ...state.readAt, [selected]: latest } }));
		void rpc.request.set_read_at({ name: selected, readAt: latest });
	}

	function install() {
		session.subscribe(() => {
			syncWatermarks();
			markSelectedRead();
		});
		syncWatermarks();
		markSelectedRead();
	}

	return { store, install };
}
