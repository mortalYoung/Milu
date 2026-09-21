import { createContext, type ReactNode, useContext } from "react";
import type { createAgentStatus } from "../agent-status";

export { EMPTY_STATUS } from "../agent-status";

export type AgentStatus = ReturnType<typeof createAgentStatus>;

const AgentStatusContext = createContext<AgentStatus | undefined>(undefined);

export function AgentStatusProvider(props: { value: AgentStatus; children?: ReactNode }) {
	return <AgentStatusContext.Provider value={props.value}>{props.children}</AgentStatusContext.Provider>;
}

export function useAgentStatus(): AgentStatus {
	const ctx = useContext(AgentStatusContext);
	if (!ctx) throw new Error("useAgentStatus must be used within AgentStatusProvider");
	return ctx;
}
