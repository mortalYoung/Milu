import { createStore } from "zustand/vanilla";
import type { TaskSummary } from "../../shared/rpc";
import type { RPC } from "./rpc";

export function createTasks(rpc: RPC) {
	const store = createStore<{ tasks: TaskSummary[]; version: number; output: number }>()(() => ({ tasks: [], version: 0, output: 0 }));
	let seq = 0;

	async function refresh(name: string | null) {
		if (!name) {
			store.setState({ tasks: [] });
			return;
		}
		const token = ++seq;
		const res = await rpc.request.task_list({ name });
		if (token !== seq) return;
		store.setState({ tasks: res.tasks });
	}

	function install() {
		rpc.addMessageListener("task_update", ({ kind }) => {
			store.setState((state) => (kind === "output" ? { output: state.output + 1 } : { version: state.version + 1 }));
		});
	}

	return { store, refresh, install };
}

export type Tasks = ReturnType<typeof createTasks>;
