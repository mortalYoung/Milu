import { createSignal } from "solid-js";
import { fuzzyScore } from "../../shared/fuzzy";
import type { CommandDescriptor } from "../../shared/rpc";
import type { PartnerItem } from "../components/ConversationList";
import type { RevealRange } from "./dock";

export type PaletteMode = "sessions" | "files" | "commands";

export interface PaletteFile {
	path: string;
	name: string;
}

export type PaletteRow =
	| { kind: "header"; label: string }
	| { kind: "session"; partner: PartnerItem }
	| { kind: "file"; file: PaletteFile }
	| { kind: "command"; command: CommandDescriptor };

export function createPalette() {
	const [open, setOpen] = createSignal(false);
	const [mode, setMode] = createSignal<PaletteMode>("sessions");
	const [query, setQuery] = createSignal("");
	const [index, setIndex] = createSignal(0);
	const [focusSeq, setFocusSeq] = createSignal(0);

	/** Open, or — when already open — just refocus the input (Cmd+P again). */
	function launch() {
		setOpen(true);
		setFocusSeq((n) => n + 1);
	}

	function close() {
		setOpen(false);
		setQuery("");
		setMode("sessions");
		setIndex(0);
	}

	function cycleMode(dir: 1 | -1, available: PaletteMode[]) {
		if (available.length === 0) return;
		const at = available.indexOf(mode());
		setMode(available[(at + dir + available.length) % available.length]);
	}

	return { open, mode, query, index, focusSeq, launch, close, cycleMode, setMode, setQuery, setIndex };
}

export type Palette = ReturnType<typeof createPalette>;

/** Rows that can be picked (headers are labels, not targets). */
export function pickableIndexes(rows: PaletteRow[]): number[] {
	return rows.map((row, index) => (row.kind === "header" ? -1 : index)).filter((index) => index >= 0);
}

/**
 * `src/a.ts#16` / `src/a.ts#74-80` — the reference syntax the Explorer's "Copy Relative Path" writes.
 * Anything that is not `<digits>[-<digits>]` after `#` stays part of the path query.
 */
export function parseFileQuery(query: string): { path: string; range: RevealRange | null } {
	const at = query.indexOf("#");
	if (at === -1) return { path: query.trim(), range: null };
	const tail = query.slice(at + 1).trim();
	const match = /^(\d+)(?:-(\d+))?$/.exec(tail);
	if (!match) return { path: query.trim(), range: null };
	const before = query.slice(0, at).trim();
	const first = Number(match[1]);
	const second = match[2] ? Number(match[2]) : first;
	// `foo.ts#0` is a line reference that cannot be honoured — drop it, but still search the path.
	if (first < 1 || second < 1) return { path: before, range: null };
	return { path: before, range: { start: Math.min(first, second), end: Math.max(first, second) } };
}

export function splitPath(path: string): { dir: string; name: string } {
	const at = path.lastIndexOf("/");
	return at === -1 ? { dir: "", name: path } : { dir: path.slice(0, at), name: path.slice(at + 1) };
}

export function sessionRows(partners: PartnerItem[], query: string): PaletteRow[] {
	const q = query.trim();
	if (!q) {
		return [...partners].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.name.localeCompare(b.name)).map((partner) => ({ kind: "session" as const, partner }));
	}
	const hits: { partner: PartnerItem; name: number | null; persona: number | null }[] = [];
	for (const partner of partners) {
		const name = fuzzyScore(q, partner.name);
		const persona = partner.persona ? fuzzyScore(q, partner.persona) : null;
		if (name !== null || persona !== null) hits.push({ partner, name, persona });
	}
	// Name hits rank above persona hits, then better score, then newest.
	hits.sort(
		(a, b) =>
			Number(b.name !== null) - Number(a.name !== null) ||
			(b.name ?? 0) - (a.name ?? 0) ||
			(b.persona ?? 0) - (a.persona ?? 0) ||
			(b.partner.lastMessageAt ?? 0) - (a.partner.lastMessageAt ?? 0),
	);
	return hits.map(({ partner }) => ({ kind: "session" as const, partner }));
}

export function fileRows(files: PaletteFile[], query: string): PaletteRow[] {
	const { path: needle } = parseFileQuery(query);
	const q = needle.trim();
	const lower = q.toLowerCase();
	const hits: { file: PaletteFile; score: number }[] = [];
	for (const file of files) {
		const score = fuzzyScore(q, file.path);
		if (score !== null) hits.push({ file, score });
	}
	// An exact path (typically pasted from the Explorer with a line reference) beats every fuzzy hit.
	hits.sort((a, b) => Number(b.file.path.toLowerCase() === lower) - Number(a.file.path.toLowerCase() === lower) || b.score - a.score || a.file.path.length - b.file.path.length);
	return hits.map(({ file }) => ({ kind: "file" as const, file }));
}

export function commandRows(commands: CommandDescriptor[], query: string): PaletteRow[] {
	const q = query.trim();
	const hits: { command: CommandDescriptor; score: number }[] = [];
	for (const command of commands) {
		const name = fuzzyScore(q, command.name);
		const description = fuzzyScore(q, command.description);
		if (!q) hits.push({ command, score: 0 });
		else if (name !== null || description !== null) hits.push({ command, score: (name ?? 0) * 2 + (description ?? 0) + (name !== null ? 8 : 0) });
	}
	hits.sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name));

	const rows: PaletteRow[] = [];
	for (const [label, pick] of [
		["Commands", (x: CommandDescriptor) => x.category !== "skill"],
		["Skills", (x: CommandDescriptor) => x.category === "skill"],
	] as const) {
		const group = hits.filter((hit) => pick(hit.command));
		if (group.length === 0) continue;
		rows.push({ kind: "header", label });
		for (const { command } of group) rows.push({ kind: "command", command });
	}
	return rows;
}
