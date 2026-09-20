import type { EscalationStatus, SandboxMode } from "../../shared/rpc";

export interface EscalationInfo {
	id: string;
	command: string;
	from: SandboxMode;
	to: SandboxMode;
	justification: string;
	status: EscalationStatus;
}

export interface CommandInfo {
	commandId: string;
	name: string;
	args?: string;
	text?: string;
	status: "running" | "success" | "error" | "interrupted";
}

export interface Entry {
	id: number;
	kind: "user" | "agent" | "sys" | "sep" | "escalation" | "command" | "skill" | "shell";
	text: string;
	time?: string;
	error?: boolean;
	aborted?: boolean;
	escalation?: EscalationInfo;
	command?: CommandInfo;
	skill?: CommandInfo;
	files?: string[];

	key?: string;
}

let nextId = 1;
const pad = (n: number) => String(n).padStart(2, "0");

const fmtDateTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export function makeUserEntry(text: string, time = Date.now()): Entry {
	return { id: nextId++, kind: "user", text, time: fmtDateTime(new Date(time)) };
}

export function makeAgentEntry(text: string, time = Date.now(), files?: string[]): Entry {
	return { id: nextId++, kind: "agent", text, time: fmtDateTime(new Date(time)), ...(files ? { files } : {}) };
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
