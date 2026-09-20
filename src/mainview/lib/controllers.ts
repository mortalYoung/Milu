import { createAgentStatus } from "./agent-status";
import { watchMenuState } from "./menu-state";
import { rpc } from "./rpc";
import { createSession } from "./session";

export const session = createSession(rpc);
export const status = createAgentStatus(rpc, session.store);

export function boot() {
	status.install();
	watchMenuState(rpc, session.store, status);
	void session.mutate.refreshPartners();
	void session.mutate.refreshHistory();
}
