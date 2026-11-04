import { LOG_EVENTS } from "@milu/protocol";

export const EVENTS = LOG_EVENTS;

export type ReminderType = (typeof EVENTS)["timeGapReminder" | "contextChanged" | "instructionsChanged" | "mcpChanged" | "memoryContext" | "peerMessage"];

export interface AgentReminder {
	readonly type: ReminderType;
	readonly data: Record<string, unknown>;
}

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

export function reminderText(type: ReminderType, data: Record<string, unknown>): string {
	switch (type) {
		case EVENTS.timeGapReminder:
			return typeof data["text"] === "string" ? data["text"] : "";
		case EVENTS.contextChanged:
			return contextChangedText({
				workspace: typeof data["workspace"] === "string" ? data["workspace"] : null,
				storage: typeof data["storage"] === "string" ? data["storage"] : null,
				sandbox: typeof data["sandbox"] === "string" ? data["sandbox"] : "workspace-write",
				skills: Array.isArray(data["skills"]) ? (data["skills"] as ContextChangedData["skills"]) : [],
			});
		case EVENTS.instructionsChanged:
			return instructionsChangedText(typeof data["agentMd"] === "string" ? data["agentMd"] : null);
		case EVENTS.memoryContext:
			return typeof data["text"] === "string" ? data["text"] : "";
		case EVENTS.peerMessage: {
			const id = escapeXml(JSON.stringify(typeof data["from"] === "string" ? data["from"] : ""));
			return `<system_reminder>This message came from agent ${id}. If you want that agent to receive a result, send it with peer({ op: "send", peer: ${id}, text: "<self-contained result>" }). It does not automatically receive your transcript, tool output, or reasoning. Send another message as soon as a finding changes what that agent should do next; sending a message does not end your turn. Replying is optional.</system_reminder>`;
		}
		case EVENTS.mcpChanged:
			return mcpChangedText({
				server: typeof data["server"] === "string" ? data["server"] : "",
				change: data["change"] === "removed" ? "removed" : "added",
				granted: Array.isArray(data["granted"]) ? data["granted"].filter((value): value is string => typeof value === "string") : [],
			});
	}
}
