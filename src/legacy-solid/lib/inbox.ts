import { createStore } from "solid-js/store";
import type { QueuedMessageRpc } from "../../shared/rpc";
import type { RPC } from "./rpc";

export function createInbox(rpc: RPC) {
	const [queued, setQueued] = createStore<Record<string, QueuedMessageRpc[]>>({});
	let seq = 0;

	rpc.addMessageListener("inbox_update", (event) => {
		seq += 1;
		const list = queued[event.partner] ?? [];
		if (event.kind === "inserted") {
			const index = list.findIndex((item) => item.id === event.item.id);
			setQueued(event.partner, index < 0 ? [...list, event.item] : list.map((item, i) => (i === index ? event.item : item)));
			return;
		}
		if (event.kind === "cleared") {
			setQueued(event.partner, []);
			return;
		}
		setQueued(
			event.partner,
			list.filter((item) => item.id !== event.id),
		);
	});

	async function cancel(partner: string, id: string) {
		const res = await rpc.request.cancel_follow_up({ id });
		if (res.ok) return;
		setQueued(
			partner,
			(queued[partner] ?? []).filter((item) => item.id !== id),
		);
	}

	rpc.addMessageListener("agent_end", ({ partner }) => {
		void refresh(partner);
	});

	async function refresh(partner: string) {
		const stamp = seq;
		const res = await rpc.request.follow_up_list({ name: partner });
		if (stamp !== seq) return;
		setQueued(partner, res.items);
	}

	return {
		list: (partner: string | null | undefined): QueuedMessageRpc[] => (partner ? (queued[partner] ?? []) : []),
		refresh,
		cancel,
	};
}
