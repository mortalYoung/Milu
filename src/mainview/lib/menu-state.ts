import type { StoreApi } from "zustand/vanilla";
import type { createAgentStatus } from "./agent-status";
import type { RPC } from "./rpc";
import type { SessionData } from "./session";

export function watchMenuState(rpc: RPC, session: StoreApi<SessionData>, status: ReturnType<typeof createAgentStatus>) {
	let last: string | null = null;

	const sync = () => {
		const partner = session.getState().selected != null;
		const snapshot = status.settled() ? status.data() : null;
		const workspace = partner && snapshot?.workspace_path != null;
		const next = { partner, workspace, git: workspace && snapshot?.is_git_repo === true };
		const key = `${next.partner}|${next.workspace}|${next.git}`;
		if (key === last) return;
		last = key;
		void rpc.request.set_menu_state(next);
	};

	sync();
	const unsubscribeSession = session.subscribe(sync);
	const unsubscribeStatus = status.store.subscribe(sync);

	return () => {
		unsubscribeSession();
		unsubscribeStatus();
	};
}
