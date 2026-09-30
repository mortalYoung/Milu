import type { McpServerStatusState } from "../../shared/rpc";

export function mcpStateColor(state: McpServerStatusState): string {
	if (state === "connected") return "bg-ink";
	if (state === "error") return "bg-signal";
	if (state === "connecting") return "bg-ink-soft";
	return "bg-muted-soft";
}
