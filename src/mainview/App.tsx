import { createEffect, createSignal, lazy, onCleanup, onMount, Suspense } from "solid-js";
import { parseLineRange, workspacePath, workspaceRelativePath } from "../shared/file-mentions";
import { AppRail } from "./components/AppRail";
import type { PartnerItem } from "./components/ConversationList";
import { ToastHost } from "./components/ToastHost";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { createAgentStatus } from "./lib/agent-status";
import { createCommandDirectory } from "./lib/commands";
import { createComposer } from "./lib/composer";
import { AgentStatusProvider } from "./lib/contexts/agent-status-context";
import { CommandDirectoryProvider } from "./lib/contexts/commands-context";
import { ComposerProvider } from "./lib/contexts/composer-context";
import { MetricsProvider } from "./lib/contexts/metrics-context";
import { SessionProvider, useSession } from "./lib/contexts/session-context";
import { SettingsProvider } from "./lib/contexts/settings-context";
import { SkillsProvider } from "./lib/contexts/skills-context";
import { ToastProvider, useToast } from "./lib/contexts/toast-context";
import { TrajectoryProvider } from "./lib/contexts/trajectory-context";
import { TranscriptProvider } from "./lib/contexts/transcript-context";
import { createDock } from "./lib/dock";
import { useKeybindings } from "./lib/keybindings";
import { COPIED_ICON_SVG, COPY_ICON_SVG, warmUpMarkdown } from "./lib/markdown";
import { createMetrics } from "./lib/metrics";
import { createPalette } from "./lib/palette";
import type { PartnerFormData } from "./lib/partner-form";
import { rpc } from "./lib/rpc";
import { createSession } from "./lib/session";
import { createSettings } from "./lib/settings";
import { createSkills } from "./lib/skills";
import { createToast } from "./lib/toast";
import { createTrajectory } from "./lib/trajectory";
import { createTranscript } from "./lib/transcript";
import { createUnread } from "./lib/unread";
import { ConversationPage } from "./pages/ConversationPage";

// On-demand overlays/views are lazy-loaded so they stay out of the main chat chunk.
const PartnerDetailsDialog = lazy(() => import("./components/PartnerDetailsDialog").then((m) => ({ default: m.PartnerDetailsDialog })));
const PartnerModal = lazy(() => import("./components/PartnerModal").then((m) => ({ default: m.PartnerModal })));
const CommandPalette = lazy(() => import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const TrajectoryDrawer = lazy(() => import("./components/TrajectoryDrawer").then((m) => ({ default: m.TrajectoryDrawer })));
const SettingsView = lazy(() => import("./pages/SettingsView").then((m) => ({ default: m.SettingsView })));
const SkillsView = lazy(() => import("./pages/SkillsView").then((m) => ({ default: m.SkillsView })));

export function App() {
	const session = createSession(rpc);
	const toast = createToast();

	return (
		<SessionProvider value={session}>
			<ToastProvider value={toast}>
				<WorkspaceControllers />
			</ToastProvider>
		</SessionProvider>
	);
}

function WorkspaceControllers() {
	const session = useSession();
	const toast = useToast();

	// ——— UI chrome / local window state ———
	const [view, setView] = createSignal<"chat" | "skills">("chat");
	const [showModal, setShowModal] = createSignal(false);
	const [detailsPartner, setDetailsPartner] = createSignal<PartnerItem | null>(null);
	const [listCollapsed, setListCollapsed] = createSignal(localStorage.getItem("chatlist.collapsed") === "1");
	const toggleList = () => {
		const next = !listCollapsed();
		setListCollapsed(next);
		localStorage.setItem("chatlist.collapsed", next ? "1" : "0");
	};

	// ——— feature controllers ———
	const status = createAgentStatus(rpc);
	const metrics = createMetrics(rpc);
	const trajectory = createTrajectory();
	const dock = createDock({ onOpen: () => trajectory.mutate.setOpen(false) });
	const palette = createPalette();
	const transcript = createTranscript();
	const composer = createComposer();
	const commands = createCommandDirectory(rpc);
	const settings = createSettings(rpc);
	const skills = createSkills(rpc);
	createEffect(() => {
		const ms = settings.data()?.settings?.toastDurationMs;
		if (ms != null) toast.setDurationMs(ms);
	});

	// ——— global keybindings ———
	useKeybindings([
		{ key: ",", meta: true, handler: () => settings.mutate.setOpen(true) },
		{ key: "b", meta: true, handler: toggleList },
		{ key: "w", meta: true, handler: () => closeCurrentChat() },
		{ key: "p", meta: true, handler: () => palette.launch() },
	]);

	// ——— partner navigation helpers ———
	const selectPartner = (p: Parameters<typeof session.mutate.select>[0]) => {
		if (p?.name === session.data.selected) return;

		toast.dismissAll();
		session.mutate.select(p);
	};
	const closeCurrentChat = () => {
		if (!session.data.selected) return;

		transcript.reset();
		selectPartner(null);
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

	// ——— RPC event listeners ———
	rpc.addMessageListener("agent_turn", ({ partner }) => {
		status.beginTurn(partner);
		void session.mutate.refreshPartners();
	});

	rpc.addMessageListener("agent_end", async ({ error: err, partner }) => {
		status.endTurn(partner);

		if (partner === session.data.selected) {
			void session.mutate.refreshHistory();
			void session.mutate.refreshPartners().then(
				() => status.releaseTurn(partner),
				() => status.releaseTurn(partner),
			);
		} else {
			await session.mutate.refreshPartners();
			status.releaseTurn(partner);
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

	// ——— actions ———
	function onSend(text: string) {
		transcript.scrollToBottom(true);
		void rpc.request.chat({ text }).then((res) => {
			if (res.accepted) composer.clear(session.data.selected!);
			void session.mutate.refreshHistory();
		});
	}

	async function onDeletePartner(name: string) {
		await rpc.request.delete_partner({ name });

		const selected = session.data.selected;
		const selectedIsDeleted = selected === name || session.data.partners.find((p) => p.name === selected)?.forkedFrom === name;
		if (selectedIsDeleted) {
			transcript.reset();
			selectPartner(null);
		}
		void session.mutate.refreshPartners();
	}

	async function onCreatePartner(data: PartnerFormData): Promise<string | null> {
		const res = await rpc.request.create_partner(data);
		if (res.ok) {
			setShowModal(false);
			void session.mutate.refreshPartners();
			if (res.profile) {
				transcript.reset();
				selectPartner(res.profile);
			}
			return null;
		}
		return res.error ?? "Failed to create partner";
	}

	async function runCopy(kind: "duplicate" | "fork", name: string) {
		const res = kind === "duplicate" ? await rpc.request.duplicate_partner({ name }) : await rpc.request.fork_partner({ name });
		if (!res.ok || !res.profile) {
			toast.push({ title: kind === "duplicate" ? "Duplicate failed" : "Fork failed", body: res.error ?? "Unknown error" }, "error");
			return;
		}
		toast.push({ title: kind === "duplicate" ? "Duplicated" : "Forked", body: `Now working as ${res.profile.name}` });
		await session.mutate.refreshPartners();
		transcript.reset();
		selectPartner(res.profile);
	}

	async function onPromotePartner(name: string) {
		const res = await rpc.request.promote_partner({ name });
		if (!res.ok || !res.profile) {
			toast.push({ title: "Promote failed", body: res.error ?? "Unknown error" }, "error");
			return;
		}
		toast.push({ title: `Promoted "${name}"`, body: "Now a root chat" });
		await session.mutate.refreshPartners();
	}

	// ——— theme + startup effects ———
	let flipTimer: ReturnType<typeof setTimeout> | undefined;
	createEffect(() => {
		const theme = settings.data()?.settings?.theme ?? "system";
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

	void session.mutate.refreshHistory();
	void session.mutate.refreshPartners();

	void rpc.request.list_editors({}).then((res) => setEditors(res.editors));
	status.calibrate();

	// ——— refresh partners when the app returns to the foreground ———
	let refreshPartnersTimer: ReturnType<typeof setTimeout> | undefined;
	const refreshPartnersOnVisible = () => {
		if (document.visibilityState !== "visible") return;
		clearTimeout(refreshPartnersTimer);
		refreshPartnersTimer = setTimeout(() => {
			void session.mutate.refreshPartners();
		}, 150);
	};
	window.addEventListener("focus", refreshPartnersOnVisible);
	document.addEventListener("visibilitychange", refreshPartnersOnVisible);
	onCleanup(() => {
		clearTimeout(refreshPartnersTimer);
		window.removeEventListener("focus", refreshPartnersOnVisible);
		document.removeEventListener("visibilitychange", refreshPartnersOnVisible);
	});

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

		document.addEventListener("click", (event) => {
			const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
			const href = anchor?.getAttribute("href");
			if (!href) return;
			event.preventDefault();
			if (/^(https?|mailto):/i.test(href)) void rpc.request.open_external({ url: href });
		});

		document.addEventListener("click", (event) => {
			const mention = (event.target as HTMLElement | null)?.closest?.(".md-file-mention");
			const path = mention?.getAttribute("data-path");
			if (!path) return;
			event.preventDefault();
			const baseDir = session.data.origin.baseDir;
			if (!event.metaKey) {
				dock.revealInExplorer(workspaceRelativePath(path, baseDir), parseLineRange(mention?.getAttribute("data-range")));
				return;
			}
			void rpc.request.open_path({ path: workspacePath(path, baseDir) }).then((res) => {
				if (!res.ok) toast.push({ title: "Couldn't open file", body: res.error ?? "No supported editor found" }, "error");
			});
		});
	});

	return (
		<TrajectoryProvider value={trajectory}>
			<ComposerProvider value={composer}>
				<CommandDirectoryProvider value={commands}>
					<SettingsProvider value={settings}>
						<SkillsProvider value={skills}>
							<div class="relative flex flex-1 min-h-0">
								<AppRail
									active={view()}
									onSelect={(tab) => {
										if (tab === "settings") settings.mutate.setOpen(true);
										else setView(tab);
									}}
								/>

								<main class="flex-1 flex flex-col min-w-0 bg-qw-bg">
									<AgentStatusProvider value={status}>
										<MetricsProvider value={metrics.data}>
											{view() === "skills" ? (
												<Suspense fallback={null}>
													<SkillsView />
												</Suspense>
											) : (
												<TranscriptProvider value={transcript}>
													<ConversationPage
														dock={dock}
														partners={session.data.partners}
														selected={session.data.selected}
														onSelect={(name) => {
															transcript.reset();
															selectPartner(session.data.partners.find((p) => p.name === name) ?? null);
														}}
														unread={unread.unread}
														onAddPartner={() => setShowModal(true)}
														onDelete={onDeletePartner}
														onViewDetails={(name) => setDetailsPartner(session.data.partners.find((p) => p.name === name) ?? null)}
														onDuplicate={(name) => void runCopy("duplicate", name)}
														onFork={(name) => void runCopy("fork", name)}
														onPromote={(name) => void onPromotePartner(name)}
														listCollapsed={listCollapsed()}
														onToggleList={toggleList}
														historyLoading={session.historyLoading}
														onSend={onSend}
														onStop={() => void rpc.request.stop({})}
														onEscalationRespond={(id, approved) => void rpc.request.sandbox_respond({ id, approved })}
														toastHost={<ToastHost toasts={toast.toasts} placement={settings.data()?.settings?.toastPlacement ?? "bottomcenter"} onDismiss={toast.dismiss} />}
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

								<Dialog open={settings.open()} onOpenChange={settings.mutate.setOpen}>
									<DialogContent class="w-[820px] max-w-none h-[640px] grid-rows-[auto_1fr] overflow-hidden bg-letter border-print-line p-0">
										<DialogHeader class="px-4 pt-4">
											<DialogTitle class="font-serif text-[15px]">Settings</DialogTitle>
										</DialogHeader>
										<Suspense fallback={null}>
											<SettingsView />
										</Suspense>
									</DialogContent>
								</Dialog>

								<Suspense fallback={null}>
									<PartnerModal open={showModal()} onOpenChange={setShowModal} onConfirm={onCreatePartner} existingNames={session.data.partners.map((p) => p.name)} />
								</Suspense>

								<Suspense fallback={null}>
									<PartnerDetailsDialog partner={detailsPartner()} onOpenChange={(open) => !open && setDetailsPartner(null)} />
								</Suspense>

								<Suspense fallback={null}>
									<TrajectoryDrawer />
								</Suspense>

								<Suspense fallback={null}>
									<CommandPalette
										palette={palette}
										partner={session.data.selected}
										partners={session.data.partners}
										hasWorkspace={status.data().workspace_path != null}
										unread={unread.unread}
										onSelectPartner={(name) => {
											settings.mutate.setOpen(false);
											setView("chat");
											transcript.reset();
											selectPartner(session.data.partners.find((p) => p.name === name) ?? null);
										}}
										onRevealFile={(path, range) => {
											settings.mutate.setOpen(false);
											dock.revealInExplorer(path, range);
										}}
										onOpenFile={(path) => {
											settings.mutate.setOpen(false);
											void rpc.request.open_path({ path }).then((res) => {
												if (!res.ok) toast.push({ title: "Couldn't open file", body: res.error ?? "No supported editor found" }, "error");
											});
										}}
									/>
								</Suspense>
							</div>
						</SkillsProvider>
					</SettingsProvider>
				</CommandDirectoryProvider>
			</ComposerProvider>
		</TrajectoryProvider>
	);
}
