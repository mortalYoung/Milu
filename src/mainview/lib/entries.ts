import type { EscalationStatus, SandboxMode } from "../../shared/rpc";

export interface EscalationInfo {
	id: string;
	command: string;
	from: SandboxMode;
	to: SandboxMode;
	justification: string;
	status: EscalationStatus;
}

export interface PeerReplyInfo {
	from: string;
	requestId?: string;
}

export interface CommandInfo {
	commandId: string;
	name: string;
	args?: string;
	text?: string;
	status: "running" | "success" | "error" | "interrupted";
}

export interface ScheduleOriginInfo {
	scheduleId: string;
	title: string;
	runId?: string;
	trigger?: "schedule" | "manual" | "catchup";
	status?: "dispatched" | "done" | "failed" | "skipped" | "missed";
	error?: string;
}

export interface Entry {
	id: number;
	kind: "user" | "agent" | "sys" | "sep" | "escalation" | "command" | "skill" | "shell" | "reply";
	text: string;
	time?: string;
	/** The chat this message came from, when another correspondent wrote it (A2A). */
	from?: string;
	/** The chat this message was also posted to, when it answers another correspondent (A2A). */
	to?: string;
	/** Set on an incoming answer from another chat: renders as a reply card, not a user bubble. */
	reply?: PeerReplyInfo;
	error?: boolean;
	aborted?: boolean;
	escalation?: EscalationInfo;
	command?: CommandInfo;
	skill?: CommandInfo;
	/** Set on a prompt a schedule sent: the row shows where it came from. */
	schedule?: ScheduleOriginInfo;
	files?: string[];
	/** What the model thought before it spoke — a row of its own, closed until asked. */
	thinking?: { text: string; redacted?: boolean };
	/** What it called, and what came back: one row per call, the card closed until asked. */
	tool?: { name: string; summary: string; status: "running" | "success" | "error"; args?: string; result?: string; isError?: boolean };
	/** Said along the way, not the answer: a row in the timeline instead of a bubble. */
	say?: true;
	/** The step's wall clock, off the entry's own timing — what the folded summary reports. */
	stepMs?: number;

	key?: string;
}

let nextId = 1;
const pad = (n: number) => String(n).padStart(2, "0");

const fmtDateTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export function makeUserEntry(text: string, time = Date.now(), from?: string, schedule?: ScheduleOriginInfo): Entry {
	return { id: nextId++, kind: "user", text, time: fmtDateTime(new Date(time)), ...(from ? { from } : {}), ...(schedule ? { schedule } : {}) };
}

export function makeReplyEntry(item: { text: string; time: number; from: string; requestId?: string }): Entry {
	return {
		id: nextId++,
		kind: "reply",
		text: item.text,
		time: fmtDateTime(new Date(item.time)),
		reply: { from: item.from, ...(item.requestId ? { requestId: item.requestId } : {}) },
	};
}

export type AgentEntryExtras = Pick<Entry, "thinking" | "tool" | "stepMs" | "say">;

export function makeAgentEntry(text: string, time = Date.now(), files?: string[], to?: string, extras: AgentEntryExtras = {}): Entry {
	return {
		id: nextId++,
		kind: "agent",
		text,
		time: fmtDateTime(new Date(time)),
		...(files ? { files } : {}),
		...(to ? { to } : {}),
		...(extras.thinking ? { thinking: extras.thinking } : {}),
		...(extras.tool ? { tool: extras.tool } : {}),
		...(extras.stepMs != null ? { stepMs: extras.stepMs } : {}),
		...(extras.say ? { say: true } : {}),
	};
}

export function makeEscalationEntry(item: { text: string; time: number; escalation: EscalationInfo }): Entry {
	return { id: nextId++, kind: "escalation", text: item.text, time: fmtDateTime(new Date(item.time)), escalation: { ...item.escalation } };
}

export function makeCommandEntry(item: { text: string; time: number; command: CommandInfo }): Entry {
	return { id: nextId++, kind: "command", text: item.text, time: fmtDateTime(new Date(item.time)), command: { ...item.command } };
}

export function makeShellEntry(item: { text: string; time: number; command: CommandInfo }): Entry {
	return { id: nextId++, kind: "shell", text: item.text, time: fmtDateTime(new Date(item.time)), command: { ...item.command } };
}

export function makeSkillEntry(item: { text: string; time: number; skill: CommandInfo }): Entry {
	return { id: nextId++, kind: "skill", text: item.text, time: fmtDateTime(new Date(item.time)), skill: { ...item.skill } };
}

export function makeSysEntry(text: string, error = false, aborted = false): Entry {
	return { id: nextId++, kind: "sys", text, error, ...(aborted ? { aborted: true } : {}) };
}

export function makeSepEntry(text: string): Entry {
	return { id: nextId++, kind: "sep", text };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function parseStamp(raw: string | undefined): { date: string; time: string } | null {
	const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
	if (!m) return null;
	return { date: `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`, time: `${m[4]}:${m[5]}` };
}

export function formatHistoryTime(raw: string | undefined): string {
	const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
	if (!m) return "";
	const [, year, month, day, hour, minute] = m;
	const now = new Date();
	const y = Number(year);
	const mo = Number(month);
	const d = Number(day);
	const time = `${hour}:${minute}`;
	if (y === now.getFullYear() && mo === now.getMonth() + 1 && d === now.getDate()) return time;
	const md = `${MONTHS[mo - 1]} ${d}`;
	return y === now.getFullYear() ? `${md} · ${time}` : `${md} ${y} · ${time}`;
}
