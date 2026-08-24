/**
 * App — the composition root (controller). Composes the state primitives from
 * lib/, wires RPC events into them, and renders the shell: icon rail + chat /
 * settings views. Partners are created via a modal and saved as folders (see src/bun/partners.ts).
 */

import { AppRail } from "./components/AppRail";
import { PartnerDetailsDialog } from "./components/PartnerDetailsDialog";
import { PartnerModal } from "./components/PartnerModal";
import { TrajectoryDrawer } from "./components/TrajectoryDrawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { makeSysEntry } from "./layouts/Transcript";
import { createAgentStatus } from "./lib/agent-status";
import { createComposer } from "./lib/composer";
import { createMetrics } from "./lib/metrics";
import type { PartnerFormData } from "./lib/partner-form";
import { rpc } from "./lib/rpc";
import { createSession } from "./lib/session";
import { createSettings } from "./lib/settings";
import { createShell } from "./lib/shell";
import { createTrajectory } from "./lib/trajectory";
import { ConversationPage } from "./pages/ConversationPage";
import { type SettingsData, SettingsView } from "./pages/SettingsView";

export function App() {
	// ————— state primitives —————
	const metrics = createMetrics(rpc);
	const session = createSession(rpc, {
		// The session is loaded now (entries restored from JSONL): refresh the context meter too,
		// so persisted usage survives restart instead of sitting at 0% until the next turn.
		onSessionLoaded: () => void metrics.refresh(),
	});
	const status = createAgentStatus(rpc, () => session.selected());
	const trajectory = createTrajectory(rpc, () => session.selected());
	const composer = createComposer(() => session.selected());
	const shell = createShell();
	const settings = createSettings(rpc);

	// ————— RPC events —————
	rpc.addMessageListener("agent_turn", ({ turn: t, partner }) => {
		const drained = status.beginTurn(partner);
		if (drained) session.push(makeSysEntry(`✳ follow-up · turn ${t}`));
		session.bump();
	});

	rpc.addMessageListener("agent_end", ({ error: err, partner }) => {
		const errForSelected = err && partner === session.selected();
		status.endTurn(partner);
		// Errors render from the persisted turn/end entry (visibleHistory), so they survive
		// restarts — the entry is already on disk before this event lands.
		if (errForSelected) void session.refreshHistory();
		session.bump();
		status.calibrate();
		void metrics.refresh();
	});

	rpc.addMessageListener("agent_message", () => {
		// send_message is persisted; both chat and trajectory may have new content
		trajectory.invalidate();
		void session.refreshHistory();
		// …and the chat-list row preview (last message) may have changed
		void session.refreshPartners();
	});

	rpc.addMessageListener("trajectory_update", () => {
		// A turn has been persisted; invalidate the trajectory cache (next click fetches the latest)
		trajectory.invalidate();
		// …and refresh the context meter (usage is persisted per turn)
		void metrics.refresh();
	});

	rpc.addMessageListener("workspace_update", () => {
		// The workspace was set via set_workspace; refetch status to show it near the input
		status.calibrate();
	});

	rpc.addMessageListener("sandbox_mode_update", () => {
		// The mode changed (composer select / partner switch); refetch status to stay in sync
		status.calibrate();
	});

	rpc.addMessageListener("escalation_update", () => {
		void session.refreshHistory();
		// Recalibrate busy: a request pauses the run (idle until the human clicks), a decision
		// resumes it (writing returns) — get_status reports the view-facing streaming value.
		status.calibrate();
	});

	// ————— user input —————
	function onSend(text: string) {
		if (status.isBusyForSelected()) {
			session.push(makeSysEntry("✳ follow-up queued"));
			status.queueFollowUp();
		}
		void rpc.request.chat({ text }).then((res) => {
			// Each partner runs its own agent: a message to the selected chat is that agent's fresh
			// run or its own follow-up (queued by the outer loop when busy) — never cross-partner.
			if (res.accepted) composer.clear(session.selected()!);
			void session.refreshHistory();
		});
	}

	// ————— Partner deletion —————
	async function onDeletePartner(name: string) {
		await rpc.request.delete_partner({ name });
		// If the deleted Partner was selected: close it immediately (reset selection and prompt)
		if (session.selected() === name) session.select(null);
		void session.refreshPartners();
	}

	// ————— Partner creation —————
	async function onCreatePartner(data: PartnerFormData): Promise<string | null> {
		const res = await rpc.request.create_partner(data);
		if (res.ok) {
			shell.setShowModal(false);
			void session.refreshPartners();
			if (res.profile) session.select(res.profile);
			return null;
		}
		return res.error ?? "Failed to create partner";
	}

	// ————— mount —————
	void session.refreshHistory();
	void session.refreshPartners();
	void settings.refresh();
	status.calibrate();
	void metrics.refresh();

	// ————— shell —————
	return (
		<div class="relative flex flex-1 min-h-0">
			<AppRail active={shell.view()} onSelect={(tab) => (tab === "settings" ? shell.setSettingsOpen(true) : shell.setView("chat"))} />

			<main class="flex-1 flex flex-col min-w-0 bg-qw-bg">
				<ConversationPage
					partners={session.partners()}
					selected={session.selected()}
					onSelect={(name) => session.select(session.partners().find((p) => p.name === name) ?? null)}
					onAddPartner={() => shell.setShowModal(true)}
					onDelete={onDeletePartner}
					onViewDetails={(name) => shell.setDetailsPartner(session.partners().find((p) => p.name === name) ?? null)}
					listCollapsed={shell.listCollapsed()}
					onToggleList={shell.toggleList}
					entries={session.entries}
					working={status.isBusyForSelected}
					tick={session.tick}
					historyLoading={session.historyLoading}
					busy={status.isBusyForSelected}
					onSend={onSend}
					onStop={() => void rpc.request.stop({})}
					onViewTrajectory={trajectory.view}
					onCloseTrajectory={() => trajectory.setOpen(false)}
					flashId={trajectory.flashId}
					onFlash={trajectory.flash}
					workspacePath={status.workspacePath()}
					storagePath={status.storagePath()}
					sandboxMode={status.sandboxMode()}
					onSetSandboxMode={(mode) => void status.onSetSandboxMode(mode)}
					onEscalationRespond={(id, approved) => void rpc.request.sandbox_respond({ id, approved })}
					contextUsage={metrics.contextUsage()}
					stats={metrics.stats()}
					workingFor={status.workingFor}
					draft={session.selected() ? (composer.drafts()[session.selected()!] ?? "") : ""}
					onDraftChange={composer.change}
				/>
			</main>

			{/* Settings: dialog */}
			<Dialog open={shell.settingsOpen()} onOpenChange={shell.setSettingsOpen}>
				<DialogContent class="w-[440px] bg-white border-print-line">
					<DialogHeader>
						<DialogTitle>Settings</DialogTitle>
					</DialogHeader>
					<SettingsView settings={settings.settings()} runtime={settings.runtime()} onLoad={() => void settings.refresh()} onSave={(s: SettingsData) => settings.save(s)} />
				</DialogContent>
			</Dialog>

			<PartnerModal open={shell.showModal()} onOpenChange={shell.setShowModal} onConfirm={onCreatePartner} existingNames={session.partners().map((p) => p.name)} />

			<PartnerDetailsDialog partner={shell.detailsPartner()} onOpenChange={(open) => !open && shell.setDetailsPartner(null)} />

			<TrajectoryDrawer open={trajectory.open()} onOpenChange={trajectory.setOpen} records={trajectory.records()} />
		</div>
	);
}
