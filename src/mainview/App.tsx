import { useState } from "react";
import { useStore } from "zustand";
import { AppRail, type RailTabId } from "./components/AppRail";
import { SessionBar } from "./components/SessionBar";
import { AgentStatusProvider } from "./lib/contexts/agent-status-context";
import { SessionProvider } from "./lib/contexts/session-context";
import { session, status } from "./lib/controllers";

export function App() {
	const [view, setView] = useState<RailTabId>("chat");
	const partners = useStore(session.store, (state) => state.partners);
	const selected = useStore(session.store, (state) => state.selected);
	const loading = useStore(session.historyLoading.store, (state) => state.loading);

	return (
		<SessionProvider value={session}>
			<AgentStatusProvider value={status}>
				<div className="flex min-h-0 flex-1 flex-col">
					<SessionBar view={view} />
					<div className="relative flex min-h-0 flex-1">
						<AppRail active={view} onSelect={setView} />
						<main className="flex min-w-0 flex-1 flex-col bg-qw-bg">
							<div className="grid flex-1 place-items-center">
								<span className="font-mono text-[11px] text-muted">
									{partners.length} partners · {selected ?? "none selected"}
									{loading ? " · loading" : ""}
								</span>
							</div>
						</main>
					</div>
				</div>
			</AgentStatusProvider>
		</SessionProvider>
	);
}
