import { createAgentStatus } from "./agent-status";
import { watchMenuState } from "./menu-state";
import { rpc } from "./rpc";
import { createScrollFollower } from "./scroll-follower";
import { createSession } from "./session";
import { createSkills } from "./skills";
import { createToast } from "./toast";
import { createTranscript } from "./transcript";
import { createUnread } from "./unread";

export const session = createSession(rpc);
export const toast = createToast();
export const status = createAgentStatus(rpc, session.store);
export const transcript = createTranscript(session.store);
export const scroll = createScrollFollower(transcript);
export const skills = createSkills(rpc, session.store, toast);
export const unread = createUnread(rpc, session.store);

export function boot() {
	status.install();
	skills.install();
	unread.install();
	watchMenuState(rpc, session.store, status);
	void session.mutate.refreshPartners();
	void session.mutate.refreshHistory();
}
