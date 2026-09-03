import { createContext, type JSX, useContext } from "solid-js";
import type { createAgentStatus } from "../agent-status";

export type AgentStatus = ReturnType<typeof createAgentStatus>;

const AgentStatusContext = createContext<AgentStatus | undefined>(undefined);

export function AgentStatusProvider(props: { value: AgentStatus; children?: JSX.Element }) {
	return <AgentStatusContext.Provider value={props.value}>{props.children}</AgentStatusContext.Provider>;
}

export function useAgentStatus(): AgentStatus {
	const ctx = useContext(AgentStatusContext);
	if (!ctx) throw new Error("useAgentStatus must be used within AgentStatusProvider");
	return ctx;
}
