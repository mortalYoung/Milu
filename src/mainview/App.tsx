import { useState } from "react";
import { useStore } from "zustand";
import { AppRail, type RailTabId } from "./components/AppRail";
import { SessionBar } from "./components/SessionBar";
import { Transcript } from "./layouts/Transcript";
import { AgentStatusProvider } from "./lib/contexts/agent-status-context";
import { ScrollProvider } from "./lib/contexts/scroll-context";
import { SessionProvider } from "./lib/contexts/session-context";
import { SkillsProvider } from "./lib/contexts/skills-context";
import { ToastProvider } from "./lib/contexts/toast-context";
import { TranscriptProvider } from "./lib/contexts/transcript-context";
import { scroll, session, skills, status, toast, transcript } from "./lib/controllers";
import { rpc } from "./lib/rpc";

export function App() {
	const [view, setView] = useState<RailTabId>("chat");
	const [btwAnchor, setBtwAnchor] = useState<string | null>(null);

	const selected = useStore(session.store, (state) => state.selected);
	const partners = useStore(session.store, (state) => state.partners);
	const writing = useStore(status.store, (state) => state.writing);
	const loading = useStore(session.historyLoading.store, (state) => state.loading);
	const busy = selected ? (writing[selected] ?? partners.find((p) => p.name === selected)?.writing ?? false) : false;

	return (
		<SessionProvider value={session}>
			<ToastProvider value={toast}>
				<SkillsProvider value={skills}>
					<AgentStatusProvider value={status}>
						<TranscriptProvider value={transcript}>
							<ScrollProvider value={scroll}>
								<div className="flex min-h-0 flex-1 flex-col">
									<SessionBar view={view} />
									<div className="relative flex min-h-0 flex-1">
										<AppRail active={view} onSelect={setView} />
										<main className="flex min-w-0 flex-1 flex-col bg-qw-bg">
											{view === "chat" ? (
												<Transcript
													working={busy}
													historyLoading={loading}
													worker={selected ?? undefined}
													onEscalationRespond={(id, approved) => void rpc.request.sandbox_respond({ id, approved })}
													onBtw={setBtwAnchor}
													onBtwClose={() => setBtwAnchor(null)}
													activeBtwAnchor={btwAnchor}
												/>
											) : (
												<div className="grid flex-1 place-items-center">
													<span className="font-mono text-[11px] text-muted">{view}</span>
												</div>
											)}
										</main>
									</div>
								</div>
							</ScrollProvider>
						</TranscriptProvider>
					</AgentStatusProvider>
				</SkillsProvider>
			</ToastProvider>
		</SessionProvider>
	);
}
