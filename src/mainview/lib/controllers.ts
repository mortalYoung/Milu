import { createAgentStatus } from "./agent-status";
import { createCommandDirectory } from "./commands";
import { createComposer } from "./composer";
import { createInbox } from "./inbox";
import { watchMenuState } from "./menu-state";
import { createMetrics } from "./metrics";
import { rpc } from "./rpc";
import { createScrollFollower } from "./scroll-follower";
import { createSession } from "./session";
import { createSettings } from "./settings";
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
export const inbox = createInbox(rpc);
export const composer = createComposer(session.store);
export const commands = createCommandDirectory(rpc, toast);
export const metrics = createMetrics(rpc, session.store);
export const settings = createSettings(rpc, toast);

export function boot() {
	status.install();
	skills.install();
	unread.install();
	inbox.install();
	metrics.install();
	void commands.refresh();
	void settings.refresh();
	void metrics.refresh();
	watchMenuState(rpc, session.store, status);
	void session.mutate.refreshPartners();
	void session.mutate.refreshHistory();
}
