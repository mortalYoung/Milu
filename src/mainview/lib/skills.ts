import { createStore, type StoreApi } from "zustand/vanilla";
import type { SkillDescriptor } from "../../shared/rpc";
import type { RPC } from "./rpc";
import type { SessionData } from "./session";
import type { Toast } from "./toast";

export function createSkills(rpc: RPC, session: StoreApi<SessionData>, toast: Toast) {
	const store = createStore<{ skills: SkillDescriptor[] }>()(() => ({ skills: [] }));
	let refreshSeq = 0;

	async function refresh() {
		const seq = ++refreshSeq;
		const partner = session.getState().selected;
		if (!partner) {
			store.setState({ skills: [] });
			return;
		}
		try {
			const { skills } = await rpc.request.skill_list({ partner });
			if (seq !== refreshSeq) return;
			store.setState({ skills });
		} catch (error) {
			if (seq !== refreshSeq) return;
			toast.push({ title: "Skills failed to load", body: error instanceof Error ? error.message : String(error) }, "error");
			store.setState({ skills: [] });
		}
	}

	function install() {
		rpc.addMessageListener("skills_change", () => void refresh());
		session.subscribe((state, previous) => {
			if (state.selected === previous.selected) return;
			void refresh();
		});
	}

	function execute(name: string, hint?: string) {
		return rpc.request.skill_execute({ name, ...(hint ? { hint } : {}) });
	}

	function inspect(name: string) {
		return rpc.request.skill_get({ name });
	}

	return { store, refresh, install, mutate: { refresh, execute, inspect } };
}
