import type { McpServerStatusState } from "../../shared/rpc";

export function mcpStateColor(state: McpServerStatusState): string {
	if (state === "connected") return "bg-accent-teal";
	if (state === "error") return "bg-signal";
	if (state === "connecting") return "bg-accent-teal/50";
	return "bg-muted-soft";
}
