import { createEffect, createSignal } from "solid-js";
import type { PartnerItem } from "../components/ConversationList";
import type { RPC } from "./rpc";

export function createUnread(rpc: RPC, getSelected: () => string | null, getPartners: () => PartnerItem[]) {
	const [readAt, setReadAt] = createSignal<Record<string, number>>({});

	createEffect(() => {
		for (const p of getPartners()) {
			if (p.readAt == null) continue;
			setReadAt((m) => (p.readAt! > (m[p.name] ?? 0) ? { ...m, [p.name]: p.readAt! } : m));
		}
	});

	function unread(name: string): boolean {
		const p = getPartners().find((x) => x.name === name);
		if (!p || p.lastMessageAt == null) return false;
		return p.lastMessageAt > (readAt()[name] ?? 0);
	}

	createEffect(() => {
		const name = getSelected();
		if (!name) return;
		const p = getPartners().find((x) => x.name === name);
		const latest = p?.lastMessageAt;
		if (latest == null) return;
		if (latest > (readAt()[name] ?? 0)) {
			setReadAt((m) => ({ ...m, [name]: latest! }));
			void rpc.request.set_read_at({ name, readAt: latest });
		}
	});

	return { readAt, unread };
}
