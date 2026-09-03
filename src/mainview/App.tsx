import { createEffect, createSignal, onMount } from "solid-js";
import { AppRail } from "./components/AppRail";
import { PartnerDetailsDialog } from "./components/PartnerDetailsDialog";
import { PartnerModal } from "./components/PartnerModal";
import { ToastHost } from "./components/ToastHost";
import { TrajectoryDrawer } from "./components/TrajectoryDrawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { createAgentStatus } from "./lib/agent-status";
import { createCommandDirectory } from "./lib/commands";
import { createComposer } from "./lib/composer";
import { AgentStatusProvider } from "./lib/contexts/agent-status-context";
import { CommandDirectoryProvider } from "./lib/contexts/commands-context";
import { ComposerProvider } from "./lib/contexts/composer-context";
import { MetricsProvider } from "./lib/contexts/metrics-context";
import { SessionProvider, useSession } from "./lib/contexts/session-context";
import { TrajectoryProvider } from "./lib/contexts/trajectory-context";
import { TranscriptProvider } from "./lib/contexts/transcript-context";
import { COPIED_ICON_SVG, COPY_ICON_SVG, warmUpMarkdown } from "./lib/markdown";
import { createMetrics } from "./lib/metrics";
import type { PartnerFormData } from "./lib/partner-form";
import { rpc } from "./lib/rpc";
import { createSession } from "./lib/session";
import { createSettings } from "./lib/settings";
import { createShell } from "./lib/shell";
import { createSkills } from "./lib/skills";
import { createToast, DEFAULT_TOAST_DURATION_MS } from "./lib/toast";
import { createTrajectory } from "./lib/trajectory";
import { createTranscript } from "./lib/transcript";
import { createUnread } from "./lib/unread";
import { ConversationPage } from "./pages/ConversationPage";
import { type SettingsData, SettingsView } from "./pages/SettingsView";
import { SkillsView } from "./pages/SkillsView";

export function App() {
	const session = createSession(rpc);
	return (
		<SessionProvider value={session}>
			<WorkspaceControllers />
		</SessionProvider>
	);
}

function WorkspaceControllers() {
	const session = useSession();
	const status = createAgentStatus(rpc);
	const metrics = createMetrics(rpc);
	const trajectory = createTrajectory();
	const transcript = createTranscript();
	const composer = createComposer();
	const commands = createCommandDirectory(rpc);
	const shell = createShell();
	const settings = createSettings(rpc);
	const skills = createSkills(rpc);
	const toast = createToast(() => settings.settings()?.toastDurationMs ?? DEFAULT_TOAST_DURATION_MS);
	const selectPartner = (p: Parameters<typeof session.mutate.select>[0]) => {
		if (p?.name === session.data.selected) return;

		toast.dismissAll();
		session.mutate.select(p);
	};
	const openPartner = (name: string) => {
		const p = session.data.partners.find((x) => x.name === name);
		if (p) {
			transcript.reset();
			selectPartner(p);
		}
	};
	const unread = createUnread(rpc);

	const [editors, setEditors] = createSignal<{ id: string; name: string }[]>([]);

	rpc.addMessageListener("agent_turn", ({ partner }) => {
		status.beginTurn(partner);
		void session.mutate.refreshPartners();
	});

	rpc.addMessageListener("agent_end", async ({ error: err, partner }) => {
		status.endTurn(partner);

		if (partner === session.data.selected) {
			void session.mutate.refreshHistory();
			void session.mutate.refreshPartners();
		} else {
			await session.mutate.refreshPartners();
			const p = session.data.partners.find((x) => x.name === partner);
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
		status.calibrate();
	});

	rpc.addMessageListener("agent_message", () => {
		void session.mutate.refreshHistory();

		void session.mutate.refreshPartners();
	});

	rpc.addMessageListener("origin_update", ({ partner }) => {
		if (partner === session.data.selected) void session.mutate.refreshHistory();
	});

	rpc.addMessageListener("escalation_update", () => {
		void session.mutate.refreshHistory();

		status.calibrate();
	});

	rpc.addMessageListener("command_update", () => {
		void session.mutate.refreshHistory();
		void session.mutate.refreshPartners();
		void commands.refresh();
		status.calibrate();
	});

	rpc.addMessageListener("skill_update", () => {
		void session.mutate.refreshHistory();
	});

	rpc.addMessageListener("shell_update", () => {
		void session.mutate.refreshHistory();
	});

	rpc.addMessageListener("skills_change", () => {
		void skills.refresh(session.data.selected);
	});

	function onSend(text: string) {
		transcript.scrollToBottom(true);
		void rpc.request.chat({ text }).then((res) => {
			if (res.accepted) composer.clear(session.data.selected!);
			void session.mutate.refreshHistory();
		});
	}

	async function onDeletePartner(name: string) {
		await rpc.request.delete_partner({ name });

		if (session.data.selected === name) {
			transcript.reset();
			selectPartner(null);
		}
		void session.mutate.refreshPartners();
	}

	async function onCreatePartner(data: PartnerFormData): Promise<string | null> {
		const res = await rpc.request.create_partner(data);
		if (res.ok) {
			shell.setShowModal(false);
			void session.mutate.refreshPartners();
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
		void skills.refresh(session.data.selected);
	});

	void session.mutate.refreshHistory();
	void session.mutate.refreshPartners();
	void settings.refresh();
	void rpc.request.list_editors({}).then((res) => setEditors(res.editors));
	status.calibrate();

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
		<TrajectoryProvider value={trajectory}>
			<ComposerProvider value={composer}>
				<CommandDirectoryProvider value={commands}>
					<div class="relative flex flex-1 min-h-0">
						<AppRail
							active={shell.view()}
							onSelect={(tab) => {
								if (tab === "settings") shell.setSettingsOpen(true);
								else shell.setView(tab);
							}}
						/>

						<main class="flex-1 flex flex-col min-w-0 bg-qw-bg">
							<AgentStatusProvider value={status}>
								<MetricsProvider value={metrics.data}>
									{shell.view() === "skills" ? (
										<SkillsView />
									) : (
										<TranscriptProvider value={transcript}>
											<ConversationPage
												partners={session.data.partners}
												selected={session.data.selected}
												onSelect={(name) => {
													transcript.reset();
													selectPartner(session.data.partners.find((p) => p.name === name) ?? null);
												}}
												unread={unread.unread}
												onAddPartner={() => shell.setShowModal(true)}
												onDelete={onDeletePartner}
												onViewDetails={(name) => shell.setDetailsPartner(session.data.partners.find((p) => p.name === name) ?? null)}
												listCollapsed={shell.listCollapsed()}
												onToggleList={shell.toggleList}
												historyLoading={session.historyLoading}
												onSend={onSend}
												onStop={() => void rpc.request.stop({})}
												onEscalationRespond={(id, approved) => void rpc.request.sandbox_respond({ id, approved })}
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
								</MetricsProvider>
							</AgentStatusProvider>
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

						<PartnerModal open={shell.showModal()} onOpenChange={shell.setShowModal} onConfirm={onCreatePartner} existingNames={session.data.partners.map((p) => p.name)} />

						<PartnerDetailsDialog partner={shell.detailsPartner()} onOpenChange={(open) => !open && shell.setDetailsPartner(null)} />

						<TrajectoryDrawer />
					</div>
				</CommandDirectoryProvider>
			</ComposerProvider>
		</TrajectoryProvider>
	);
}
