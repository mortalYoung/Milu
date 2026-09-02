import { createEffect, createSignal, onMount } from "solid-js";
import { AppRail } from "./components/AppRail";
import { PartnerDetailsDialog } from "./components/PartnerDetailsDialog";
import { PartnerModal } from "./components/PartnerModal";
import { ToastHost } from "./components/ToastHost";
import { TrajectoryDrawer } from "./components/TrajectoryDrawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { makeSysEntry } from "./layouts/Transcript";
import { createAgentStatus } from "./lib/agent-status";
import { createCommandDirectory } from "./lib/commands";
import { createComposer } from "./lib/composer";
import { COPIED_ICON_SVG, COPY_ICON_SVG, warmUpMarkdown } from "./lib/markdown";
import { createMetrics } from "./lib/metrics";
import { createOriginSession } from "./lib/origin-session";
import type { PartnerFormData } from "./lib/partner-form";
import { rpc } from "./lib/rpc";
import { createSession } from "./lib/session";
import { createSettings } from "./lib/settings";
import { createShell } from "./lib/shell";
import { createSkills } from "./lib/skills";
import { createToast, DEFAULT_TOAST_DURATION_MS } from "./lib/toast";
import { createTrajectory } from "./lib/trajectory";
import { createTranscriptController, TranscriptProvider } from "./lib/transcript-controller";
import { createUnread } from "./lib/unread";
import { ConversationPage } from "./pages/ConversationPage";
import { type SettingsData, SettingsView } from "./pages/SettingsView";
import { SkillsView } from "./pages/SkillsView";

export function App() {
	const metrics = createMetrics(rpc);
	const session = createSession(rpc, {
		onSessionLoaded: () => void metrics.refresh(),
	});
	const status = createAgentStatus(rpc, () => session.selected());
	const origin = createOriginSession(rpc, () => session.selected());
	session.attachOrigin(origin);
	const trajectory = createTrajectory(rpc, () => session.selected(), origin);
	const transcript = createTranscriptController({
		entries: session.entries,
		sourceHasMore: () => origin.hasMore(),
		onLoadSourcePage: () => session.loadOlderHistory(),
		onFlash: trajectory.flash,
	});
	const composer = createComposer(() => session.selected());
	const commands = createCommandDirectory(rpc);
	const shell = createShell();
	const settings = createSettings(rpc);
	const skills = createSkills(rpc);
	const toast = createToast(() => settings.settings()?.toastDurationMs ?? DEFAULT_TOAST_DURATION_MS);
	const selectPartner = (p: Parameters<typeof session.select>[0]) => {
		if (p?.name === session.selected()) return;

		toast.dismissAll();
		session.select(p);
	};
	const openPartner = (name: string) => {
		const p = session.partners().find((x) => x.name === name);
		if (p) {
			transcript.reset();
			selectPartner(p);
		}
	};
	const unread = createUnread(
		rpc,
		() => session.selected(),
		() => session.partners(),
	);

	const [editors, setEditors] = createSignal<{ id: string; name: string }[]>([]);

	rpc.addMessageListener("agent_turn", ({ turn: t, partner }) => {
		const drained = status.beginTurn(partner);
		if (drained) session.push(makeSysEntry(`✳ follow-up · turn ${t}`));
		session.bump();
	});

	rpc.addMessageListener("agent_end", async ({ error: err, partner }) => {
		const errForSelected = err && partner === session.selected();
		status.endTurn(partner);

		if (errForSelected) void session.refreshHistory();
		if (partner !== session.selected()) {
			await session.refreshPartners();
			const p = session.partners().find((x) => x.name === partner);
			const last = p?.lastMessageKind === "send_message" ? p.lastMessage : undefined;
			toast.push(
				err
					? {
							title: `${partner} ended with an error`,
							body: err || last || "Click to open this chat and review",
							onClick: () => openPartner(partner),
							avatar: partner.charAt(0),
						}
					: {
							title: `${partner} finished`,
							body: last || "Click to view the conversation",
							onClick: () => openPartner(partner),
							avatar: partner.charAt(0),
						},
				err ? "error" : "default",
			);
		}
		session.bump();
		status.calibrate();
		void metrics.refresh();
	});

	rpc.addMessageListener("agent_message", () => {
		trajectory.invalidate();
		void session.refreshHistory();

		void session.refreshPartners();
	});

	rpc.addMessageListener("trajectory_update", () => {
		trajectory.invalidate();

		void metrics.refresh();
	});

	rpc.addMessageListener("workspace_update", () => {
		status.calibrate();
	});

	rpc.addMessageListener("sandbox_mode_update", () => {
		status.calibrate();
	});

	rpc.addMessageListener("thinking_level_update", () => {
		status.calibrate();
	});

	rpc.addMessageListener("escalation_update", () => {
		void session.refreshHistory();

		status.calibrate();
	});

	rpc.addMessageListener("command_update", () => {
		void session.refreshHistory();
		void commands.refresh();
		status.calibrate();
		void metrics.refresh();
	});

	rpc.addMessageListener("skill_update", () => {
		void session.refreshHistory();
	});

	rpc.addMessageListener("shell_update", () => {
		void session.refreshHistory();
	});

	rpc.addMessageListener("skills_change", () => {
		void skills.refresh(session.selected());
	});

	function onSend(text: string) {
		if (status.isBusyForSelected()) {
			session.push(makeSysEntry("✳ follow-up queued"));
			status.queueFollowUp();
		}
		transcript.scrollToBottom(true);
		void rpc.request.chat({ text }).then((res) => {
			if (res.accepted) composer.clear(session.selected()!);
			void session.refreshHistory();
		});
	}

	async function onDeletePartner(name: string) {
		await rpc.request.delete_partner({ name });

		if (session.selected() === name) {
			transcript.reset();
			selectPartner(null);
		}
		void session.refreshPartners();
	}

	async function onCreatePartner(data: PartnerFormData): Promise<string | null> {
		const res = await rpc.request.create_partner(data);
		if (res.ok) {
			shell.setShowModal(false);
			void session.refreshPartners();
			if (res.profile) {
				transcript.reset();
				selectPartner(res.profile);
			}
			return null;
		}
		return res.error ?? "Failed to create partner";
	}

	let flipTimer: ReturnType<typeof setTimeout> | undefined;
	createEffect(() => {
		const theme = settings.settings()?.theme ?? "system";
		const root = document.documentElement;
		if (root.dataset["theme"] === theme) return;
		const flipping = root.dataset["theme"] !== undefined;
		root.dataset["theme"] = theme;
		clearTimeout(flipTimer);
		if (flipping) {
			root.classList.add("theme-flip");
			flipTimer = setTimeout(() => root.classList.remove("theme-flip"), 300);
		}
	});

	createEffect(() => {
		void skills.refresh(session.selected());
	});

	void session.refreshHistory();
	void session.refreshPartners();
	void settings.refresh();
	void commands.refresh();
	void rpc.request.list_editors({}).then((res) => setEditors(res.editors));
	status.calibrate();
	void metrics.refresh();

	onMount(() => {
		warmUpMarkdown();

		document.addEventListener("click", (event) => {
			const target = event.target as HTMLElement | null;
			const button = target?.closest?.(".md-copy");
			if (!button) return;
			const pre = button.closest(".md-code")?.querySelector("pre");
			if (!pre) return;
			const text = (pre.querySelector("code")?.textContent ?? pre.textContent ?? "").trim();
			void navigator.clipboard
				?.writeText(text)
				.then(() => {
					button.innerHTML = COPIED_ICON_SVG;
					button.setAttribute("aria-label", "Copied");
					window.setTimeout(() => {
						button.innerHTML = COPY_ICON_SVG;
						button.setAttribute("aria-label", "Copy code");
					}, 1200);
				})
				.catch(() => {});
		});
	});

	return (
		<div class="relative flex flex-1 min-h-0">
			<AppRail
				active={shell.view()}
				onSelect={(tab) => {
					if (tab === "settings") shell.setSettingsOpen(true);
					else shell.setView(tab);
				}}
			/>

			<main class="flex-1 flex flex-col min-w-0 bg-qw-bg">
				{shell.view() === "skills" ? (
					<SkillsView />
				) : (
					<TranscriptProvider controller={transcript}>
						<ConversationPage
							partners={session.partners()}
							selected={session.selected()}
							onSelect={(name) => {
								transcript.reset();
								selectPartner(session.partners().find((p) => p.name === name) ?? null);
							}}
							unread={unread.unread}
							onAddPartner={() => shell.setShowModal(true)}
							onDelete={onDeletePartner}
							onViewDetails={(name) => shell.setDetailsPartner(session.partners().find((p) => p.name === name) ?? null)}
							listCollapsed={shell.listCollapsed()}
							onToggleList={shell.toggleList}
							entries={session.entries}
							working={status.isBusyForSelected}
							historyLoading={session.historyLoading}
							busy={status.isBusyForSelected}
							onSend={onSend}
							onStop={() => void rpc.request.stop({})}
							commands={commands.commands()}
							onCommand={(line) => commands.execute(line)}
							onViewTrajectory={trajectory.view}
							onCloseTrajectory={() => trajectory.setOpen(false)}
							flashId={trajectory.flashId}
							workspacePath={status.workspacePath()}
							storagePath={status.storagePath()}
							sandboxMode={status.sandboxMode()}
							onSetSandboxMode={(mode) => void status.onSetSandboxMode(mode)}
							model={status.model()}
							models={status.models()}
							onSetModel={(model) => void status.onSetModel(model)}
							thinkingLevel={status.thinkingLevel()}
							thinkingLevels={status.thinkingLevels()}
							onSetThinkingLevel={(level) => void status.onSetThinkingLevel(level)}
							onEscalationRespond={(id, approved) => void rpc.request.sandbox_respond({ id, approved })}
							contextUsage={metrics.contextUsage()}
							stats={metrics.stats()}
							workingFor={status.workingFor}
							draft={session.selected() ? (composer.drafts()[session.selected()!] ?? "") : ""}
							onDraftChange={composer.change}
							toastHost={<ToastHost toasts={toast.toasts} placement={settings.settings()?.toastPlacement ?? "bottomcenter"} onDismiss={toast.dismiss} />}
							skills={skills.skills()}
							onSkill={(name, hint) => rpc.request.skill_execute({ name, ...(hint ? { hint } : {}) })}
							onSkillInspect={(name) => rpc.request.skill_get({ name }).then((r) => (r.ok ? (r.content ?? null) : null))}
							onShell={(command) => rpc.request.shell_execute({ command })}
							onOpenPath={(path, editorId) =>
								void rpc.request.open_path({ path, editorId }).then((res) => {
									if (!res.ok) toast.push({ title: "Couldn't open folder", body: res.error ?? "No supported editor found" }, "error");
								})
							}
							editors={editors()}
						/>
					</TranscriptProvider>
				)}
			</main>

			<Dialog open={shell.settingsOpen()} onOpenChange={shell.setSettingsOpen}>
				<DialogContent class="w-[820px] max-w-none h-[640px] grid-rows-[auto_1fr] overflow-hidden bg-letter border-print-line p-0">
					<DialogHeader class="px-4 pt-4">
						<DialogTitle class="font-serif text-[15px]">Settings</DialogTitle>
					</DialogHeader>
					<SettingsView
						settings={settings.settings()}
						runtime={settings.runtime()}
						onLoad={() => void settings.refresh()}
						onSave={(s: SettingsData, credentials) => settings.save(s, credentials)}
					/>
				</DialogContent>
			</Dialog>

			<PartnerModal open={shell.showModal()} onOpenChange={shell.setShowModal} onConfirm={onCreatePartner} existingNames={session.partners().map((p) => p.name)} />

			<PartnerDetailsDialog partner={shell.detailsPartner()} onOpenChange={(open) => !open && shell.setDetailsPartner(null)} />

			<TrajectoryDrawer
				open={trajectory.open()}
				onOpenChange={trajectory.setOpen}
				records={trajectory.records()}
				total={trajectory.total()}
				mode={trajectory.mode()}
				onModeChange={trajectory.changeMode}
				loading={trajectory.loading()}
				hasMore={trajectory.hasMore()}
				loadingOlder={trajectory.loadingOlder()}
				onLoadOlder={() => trajectory.loadOlder()}
			/>
		</div>
	);
}
