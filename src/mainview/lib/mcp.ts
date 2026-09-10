import type { McpServerStatusState } from "../../shared/rpc";

export function mcpStateColor(state: McpServerStatusState): string {
	if (state === "connected") return "bg-[#7FB069]";
	if (state === "error") return "bg-seal";
	if (state === "connecting") return "bg-[#D9A13B]";
	return "bg-muted";
}
