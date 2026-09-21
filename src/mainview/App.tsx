import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { AppRail, type RailTabId } from "./components/AppRail";
import { Composer } from "./components/Composer";
import { ConversationList } from "./components/ConversationList";
import { SessionBar } from "./components/SessionBar";
import { ToastHost } from "./components/ToastHost";
import { TooltipProvider } from "./components/ui/tooltip";
import { Transcript } from "./layouts/Transcript";
import { AgentStatusProvider } from "./lib/contexts/agent-status-context";
import { CommandDirectoryProvider } from "./lib/contexts/commands-context";
import { ComposerProvider } from "./lib/contexts/composer-context";
import { InboxProvider } from "./lib/contexts/inbox-context";
import { MetricsProvider } from "./lib/contexts/metrics-context";
import { ScrollProvider } from "./lib/contexts/scroll-context";
import { SessionProvider } from "./lib/contexts/session-context";
import { SettingsProvider } from "./lib/contexts/settings-context";
import { SkillsProvider } from "./lib/contexts/skills-context";
import { ToastProvider } from "./lib/contexts/toast-context";
import { TranscriptProvider } from "./lib/contexts/transcript-context";
import { commands as commandDirectory, composer, inbox, metrics, scroll, session, settings, skills, status, toast, transcript, unread } from "./lib/controllers";
import { rpc } from "./lib/rpc";
import type { PartnerItem } from "./lib/session";

function selectPartner(partner: PartnerItem | null) {
	if (partner?.name === session.store.getState().selected) return;
	toast.dismissAll();
	session.mutate.select(partner);
}

async function onDeletePartner(name: string) {
	await rpc.request.delete_partner({ name });
	const state = session.store.getState();
	const selected = state.selected;
	const selectedIsDeleted = selected === name || state.partners.find((p) => p.name === selected)?.forkedFrom === name;
	if (selectedIsDeleted) selectPartner(null);
	void session.mutate.refreshPartners();
}

async function runCopy(kind: "duplicate" | "fork", name: string) {
	const res = kind === "duplicate" ? await rpc.request.duplicate_partner({ name }) : await rpc.request.fork_partner({ name });
	if (!res.ok || !res.profile) {
		toast.push({ title: kind === "duplicate" ? "Duplicate failed" : "Fork failed", body: res.error ?? "Unknown error" }, "error");
		return;
	}
	toast.push({ title: kind === "duplicate" ? "Duplicated" : "Forked", body: `Now working as ${res.profile.name}` });
	await session.mutate.refreshPartners();
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

function onSend(text: string) {
	scroll.pin(true);
	void rpc.request.chat({ text }).then((res) => {
		if (res.accepted) composer.clear(session.store.getState().selected ?? "");
		void session.mutate.refreshHistory();
	});
}

function onOpenPath(path: string, editorId?: string) {
	void rpc.request.open_path({ path, editorId }).then((res) => {
		if (!res.ok) toast.push({ title: "Couldn't open folder", body: res.error ?? "No supported editor found" }, "error");
	});
}

export function App() {
	const [view, setView] = useState<RailTabId>("chat");
	const [btwAnchor, setBtwAnchor] = useState<string | null>(null);
	const [editors, setEditors] = useState<{ id: string; name: string }[]>([]);

	const selected = useStore(session.store, (state) => state.selected);
	const partners = useStore(session.store, (state) => state.partners);
	const writing = useStore(status.store, (state) => state.writing);
	const loading = useStore(session.historyLoading.store, (state) => state.loading);
	const readAt = useStore(unread.store, (state) => state.readAt);
	const toasts = useStore(toast.store, (state) => state.toasts);
	const settingsSnapshot = useStore(settings.store, (state) => state.snapshot);

	useEffect(() => {
		void rpc.request.list_editors({}).then((res) => setEditors(res.editors));
	}, []);

	const busy = selected ? (writing[selected] ?? partners.find((p) => p.name === selected)?.writing ?? false) : false;
	const isUnread = (name: string) => {
		const partner = partners.find((p) => p.name === name);
		return partner?.lastMessageAt != null && partner.lastMessageAt > (readAt[name] ?? 0);
	};

	return (
		<SessionProvider value={session}>
			<ToastProvider value={toast}>
				<SkillsProvider value={skills}>
					<AgentStatusProvider value={status}>
						<ComposerProvider value={composer}>
							<CommandDirectoryProvider value={commandDirectory}>
								<MetricsProvider value={metrics}>
									<SettingsProvider value={settings}>
										<InboxProvider value={inbox}>
											<TranscriptProvider value={transcript}>
												<ScrollProvider value={scroll}>
													<TooltipProvider>
														<div className="flex min-h-0 flex-1 flex-col">
															<SessionBar view={view} />
															<div className="relative flex min-h-0 flex-1">
																<AppRail active={view} onSelect={setView} />
																<main className="flex min-w-0 flex-1 flex-col bg-qw-bg">
																	{view === "chat" ? (
																		<div className="chat-page">
																			<ConversationList
																				partners={partners}
																				selected={selected}
																				unread={isUnread}
																				onSelect={(name) => selectPartner(partners.find((p) => p.name === name) ?? null)}
																				onAddPartner={() => {}}
																				onDelete={(name) => void onDeletePartner(name)}
																				onViewDetails={() => {}}
																				onDuplicate={(name) => void runCopy("duplicate", name)}
																				onFork={(name) => void runCopy("fork", name)}
																				onPromote={(name) => void onPromotePartner(name)}
																			/>
																			<div className="chat-window">
																				{selected ? (
																					<div className="chat-body">
																						<div className="chat-main">
																							<div className="chat-letter">
																								<div className="chat-transcript-region">
																									<Transcript
																										working={busy}
																										historyLoading={loading}
																										worker={selected}
																										onEscalationRespond={(id, approved) => void rpc.request.sandbox_respond({ id, approved })}
																										onBtw={setBtwAnchor}
																										onBtwClose={() => setBtwAnchor(null)}
																										activeBtwAnchor={btwAnchor}
																									/>
																								</div>
																								<div className="composer-slot">
																									<Composer
																										onSend={onSend}
																										onStop={() => void rpc.request.stop({})}
																										onShell={(command) => {
																											scroll.pin(true);
																											return rpc.request.shell_execute({ command });
																										}}
																										onOpenPath={onOpenPath}
																										editors={editors}
																									/>
																								</div>
																							</div>
																						</div>
																					</div>
																				) : (
																					<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
																						<p className="font-serif text-[17px] text-ink-soft">— select a partner to begin —</p>
																						<p className="eyebrow">the directory is on the left</p>
																					</div>
																				)}
																				<ToastHost toasts={toasts} placement={settingsSnapshot.settings?.toastPlacement ?? "bottomcenter"} onDismiss={toast.dismiss} />
																			</div>
																		</div>
																	) : (
																		<div className="grid flex-1 place-items-center">
																			<span className="font-mono text-[11px] text-muted">{view}</span>
																		</div>
																	)}
																</main>
															</div>
														</div>
													</TooltipProvider>
												</ScrollProvider>
											</TranscriptProvider>
										</InboxProvider>
									</SettingsProvider>
								</MetricsProvider>
							</CommandDirectoryProvider>
						</ComposerProvider>
					</AgentStatusProvider>
				</SkillsProvider>
			</ToastProvider>
		</SessionProvider>
	);
}
