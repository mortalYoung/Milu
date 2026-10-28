import { oneLine, type ViewItem } from "@milu/window/api";
import {
	AlarmClock,
	Bot,
	Brain,
	FilePen,
	FilePlus,
	FileText,
	FolderTree,
	Globe,
	ListChecks,
	type LucideIcon,
	MessagesSquare,
	Puzzle,
	Search,
	Sparkles,
	Terminal,
	Trash2,
	Wrench,
} from "lucide-react";

const FAMILIES: readonly (readonly [RegExp, LucideIcon])[] = [
	[/^mcp/, Puzzle],
	[/^(bash|sh|shell|zsh|terminal|exec|run|command)/, Terminal],
	[/^(read|cat|view|open|load)/, FileText],
	[/^(write|create|save|touch|mkdir)/, FilePlus],
	[/^(edit|patch|replace|apply|update)/, FilePen],
	[/^(grep|search|find|glob|rg)/, Search],
	[/^(ls|list|tree|dir)/, FolderTree],
	[/^(web|fetch|http|url|curl|browse|download)/, Globe],
	[/^(task|agent|subagent|spawn|delegate)/, Bot],
	[/^(memory|recall|remember)/, Brain],
	[/^(skill)/, Sparkles],
	[/^(schedule|cron|timer|remind)/, AlarmClock],
	[/^(rm|remove|delete|trash)/, Trash2],
	[/^(peer|ask|reply|message|send)/, MessagesSquare],
	[/^(todo|plan|steps)/, ListChecks],
];

export function toolIcon(name: string): LucideIcon {
	const key = name.toLowerCase();
	for (const [pattern, icon] of FAMILIES) if (pattern.test(key)) return icon;
	return Wrench;
}

const PARAMS = ["command", "cmd", "path", "file_path", "filePath", "pattern", "query", "url", "description", "prompt", "name", "title"];

export function toolArgs(tool: NonNullable<ViewItem["tool"]>): string {
	const raw = tool.args ?? "";
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return oneLine(raw) || tool.summary;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return oneLine(raw) || tool.summary;
	const record = parsed as Record<string, unknown>;
	for (const key of PARAMS) {
		const value = record[key];
		if (typeof value === "string" && value.trim() !== "") return oneLine(value);
		if (typeof value === "number") return String(value);
	}
	const flat = Object.entries(record).filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean");
	if (flat.length === 0) return tool.summary;
	return oneLine(flat.map(([key, value]) => `${key}=${String(value)}`).join(" "));
}
