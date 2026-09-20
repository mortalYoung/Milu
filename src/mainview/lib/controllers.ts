import { createAgentStatus } from "./agent-status";
import { watchMenuState } from "./menu-state";
import { rpc } from "./rpc";
import { createScrollFollower } from "./scroll-follower";
import { createSession } from "./session";
import { createTranscript } from "./transcript";

export const session = createSession(rpc);
export const status = createAgentStatus(rpc, session.store);
export const transcript = createTranscript(session.store);
export const scroll = createScrollFollower(transcript);

export function boot() {
	status.install();
	watchMenuState(rpc, session.store, status);
	void session.mutate.refreshPartners();
	void session.mutate.refreshHistory();
}
