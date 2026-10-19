export const EVENTS = {
	agentStart: "agent/start",
	agentEnd: "agent/end",
	turnStart: "turn/start",
	turnEnd: "turn/end",
	toolResult: "tool/result",
	requestHeader: "request/header",
	sendMessage: "send_message",
	systemPrompt: "system_prompt",
	timeGapReminder: "time_gap_reminder",
	compaction: "compaction",
	modelChange: "model_change",
	contextChanged: "context/changed",
	instructionsChanged: "instructions/changed",
	mcpChanged: "mcp/changed",
	rewind: "rewind",
	memoryContext: "memory/context",
} as const;

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface ContextChangedData {
	readonly workspace: string | null;
	readonly storage: string | null;
	readonly sandbox: string;
	readonly skills: readonly { readonly name: string; readonly description: string; readonly digest: string }[];
}

export function contextChangedText(data: ContextChangedData): string {
	const lines: string[] = [];
	if (data.workspace) lines.push(`Current working directory: ${data.workspace}.`);
	else lines.push("No working directory is set. Bash runs in your storage scratch directory; file tools require absolute paths.");
	lines.push(`Current storage: ${data.storage ?? "unset"}.`, `Current sandbox mode: ${data.sandbox}.`);
	if (data.skills.length > 0) {
		lines.push(
			"",
			"<available_skills>",
			...data.skills.map((skill) => `- ${escapeXml(skill.name)}: ${escapeXml(skill.description)}`),
			"</available_skills>",
			"",
			"When a task matches a skill above, call the skill tool with its exact name to load the full instructions. The latest <available_skills> message is authoritative.",
		);
	}
	return `<system_reminder>${lines.join("\n")}</system_reminder>`;
}

export function instructionsChangedText(agentMd: string | null): string {
	if (agentMd) {
		return `<system_reminder>The following working directory instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.\n\n${agentMd}</system_reminder>`;
	}
	return "<system_reminder>No working directory instructions file is present.</system_reminder>";
}

export function mcpChangedText(data: { readonly server: string; readonly change: "added" | "removed"; readonly granted: readonly string[] }): string {
	const granted = data.granted.length > 0 ? data.granted.join(", ") : "none";
	const action = data.change === "added" ? `MCP server "${data.server}" is now authorized` : `MCP server "${data.server}" is no longer authorized`;
	return `<system_reminder>${action}. Authorized servers: ${granted}. Use mcp_list to see available tools and mcp_call to invoke one.</system_reminder>`;
}
