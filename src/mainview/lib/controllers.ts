import { createAgentEvents } from "./agent-events";
import { createAgentStatus } from "./agent-status";
import { createCommandDirectory } from "./commands";
import { createComposer } from "./composer";
import { createDashboard } from "./dashboard";
import { createDock } from "./dock";
import { createInbox } from "./inbox";
import { watchMenuState } from "./menu-state";
import { createMetrics } from "./metrics";
import { createPalette } from "./palette";
import { rpc } from "./rpc";
import { createScrollFollower } from "./scroll-follower";
import { createSession, type PartnerItem } from "./session";
import { createSettings } from "./settings";
import { createSkills } from "./skills";
import { createTasks } from "./tasks";
import { createToast } from "./toast";
import { createTrajectory } from "./trajectory";
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
export const trajectory = createTrajectory(session);
export const dock = createDock({ onOpen: () => trajectory.mutate.setOpen(false), partner: () => session.store.getState().selected });
export const palette = createPalette();
export const tasks = createTasks(rpc);
export const dashboard = createDashboard(rpc);

export function selectPartner(partner: PartnerItem | null) {
	if (partner?.name === session.store.getState().selected) return;
	toast.dismissAll();
	session.mutate.select(partner);
}

export const agentEvents = createAgentEvents(rpc, {
	session,
	status,
	commands,
	toast,
	openPartner: (name) => selectPartner(session.store.getState().partners.find((p) => p.name === name) ?? null),
});

export function boot() {
	agentEvents.install();
	status.install();
	skills.install();
	unread.install();
	inbox.install();
	tasks.install();
	dashboard.install();
	metrics.install();
	void commands.refresh();
	void settings.refresh();
	void metrics.refresh();
	watchMenuState(rpc, session.store, status);
	void session.mutate.refreshPartners();
	void session.mutate.refreshHistory();
}
