import { createStore } from "zustand/vanilla";
import type { QueuedMessageRpc } from "../../shared/rpc";
import type { RPC } from "./rpc";
import type { TranscriptController } from "./transcript";

export function createInbox(rpc: RPC, transcript: TranscriptController) {
	const store = createStore<{ queued: Record<string, QueuedMessageRpc[]> }>()(() => ({ queued: {} }));
	let seq = 0;

	const setList = (partner: string, items: QueuedMessageRpc[]) => store.setState((state) => ({ queued: { ...state.queued, [partner]: items } }));

	function install() {
		rpc.addMessageListener("inbox_update", (event) => {
			seq += 1;
			const list = store.getState().queued[event.partner] ?? [];
			if (event.kind === "inserted") {
				const index = list.findIndex((item) => item.id === event.item.id);
				setList(event.partner, index < 0 ? [...list, event.item] : list.map((item, i) => (i === index ? event.item : item)));
				return;
			}
			if (event.kind === "cleared") {
				setList(event.partner, []);
				transcript.abandon(event.partner);
				return;
			}
			if (event.kind === "discarded") transcript.drop(event.partner, event.id);
			setList(
				event.partner,
				list.filter((item) => item.id !== event.id),
			);
		});

		rpc.addMessageListener("agent_end", ({ partner }) => {
			void refresh(partner);
		});
	}

	async function refresh(partner: string) {
		const stamp = seq;
		const res = await rpc.request.follow_up_list({ name: partner });
		if (stamp !== seq) return;
		setList(partner, res.items);
	}

	async function cancel(partner: string, id: string) {
		const res = await rpc.request.cancel_follow_up({ id });
		if (res.ok) return;
		setList(
			partner,
			(store.getState().queued[partner] ?? []).filter((item) => item.id !== id),
		);
	}

	return {
		store,
		list: (partner: string | null | undefined): QueuedMessageRpc[] => (partner ? (store.getState().queued[partner] ?? []) : []),
		refresh,
		cancel,
		install,
	};
}
