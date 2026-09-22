import { createStore } from "zustand/vanilla";
import { fuzzyScore } from "../../shared/fuzzy";
import { filterPartners } from "./chat-preview";
import type { RevealRange } from "./dock";
import type { PartnerItem } from "./session";

export type PaletteMode = "sessions" | "files" | "access";

export interface PaletteFile {
	path: string;
	name: string;
}

export type PaletteRow =
	| { kind: "header"; label: string }
	| { kind: "session"; partner: PartnerItem }
	| { kind: "file"; file: PaletteFile }
	| { kind: "grant"; grant: PaletteGrant };

export interface PaletteGrant {
	group: "skill" | "mcp";
	name: string;
	detail: string;
	meta?: string;
	granted: boolean;
	alwaysOn: boolean;
}

export function createPalette() {
	const store = createStore<{ open: boolean; mode: PaletteMode; query: string; index: number; focusSeq: number }>()(() => ({
		open: false,
		mode: "sessions",
		query: "",
		index: 0,
		focusSeq: 0,
	}));

	function launch(mode: PaletteMode = "sessions") {
		store.setState((state) => ({ open: true, mode: state.open ? state.mode : mode, focusSeq: state.focusSeq + 1 }));
	}

	function close() {
		store.setState({ open: false, query: "", mode: "sessions", index: 0 });
	}

	function cycleMode(dir: 1 | -1, available: PaletteMode[]) {
		if (available.length === 0) return;
		store.setState((state) => {
			const at = available.indexOf(state.mode);
			return { mode: available[(at + dir + available.length) % available.length] };
		});
	}

	return {
		store,
		launch,
		close,
		cycleMode,
		setMode: (mode: PaletteMode) => store.setState({ mode }),
		setQuery: (query: string) => store.setState({ query }),
		setIndex: (index: number) => store.setState({ index }),
	};
}

export type Palette = ReturnType<typeof createPalette>;

export function pickableIndexes(rows: PaletteRow[]): number[] {
	return rows.map((row, index) => (row.kind === "header" || (row.kind === "grant" && row.grant.alwaysOn) ? -1 : index)).filter((index) => index >= 0);
}

export function parseFileQuery(query: string): { path: string; range: RevealRange | null } {
	const at = query.indexOf("#");
	if (at === -1) return { path: query.trim(), range: null };
	const tail = query.slice(at + 1).trim();
	const match = /^(\d+)(?:-(\d+))?$/.exec(tail);
	if (!match) return { path: query.trim(), range: null };
	const before = query.slice(0, at).trim();
	const first = Number(match[1]);
	const second = match[2] ? Number(match[2]) : first;
	if (first < 1 || second < 1) return { path: before, range: null };
	return { path: before, range: { start: Math.min(first, second), end: Math.max(first, second) } };
}

export function splitPath(path: string): { dir: string; name: string } {
	const at = path.lastIndexOf("/");
	return at === -1 ? { dir: "", name: path } : { dir: path.slice(0, at), name: path.slice(at + 1) };
}

export function sessionRows(partners: PartnerItem[], query: string): PaletteRow[] {
	return filterPartners(partners, query).map((partner) => ({ kind: "session" as const, partner }));
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
	hits.sort((a, b) => Number(b.file.path.toLowerCase() === lower) - Number(a.file.path.toLowerCase() === lower) || b.score - a.score || a.file.path.length - b.file.path.length);
	return hits.map(({ file }) => ({ kind: "file" as const, file }));
}

function grantScore(grant: PaletteGrant, query: string): number | null {
	if (!query) return 0;
	const name = fuzzyScore(query, grant.name);
	const detail = grant.detail ? fuzzyScore(query, grant.detail) : null;
	if (name === null && detail === null) return null;
	return (name ?? 0) * 2 + (detail ?? 0) + (name !== null ? 8 : 0);
}

export function grantRows(grants: PaletteGrant[], query: string): PaletteRow[] {
	const q = query.trim();
	const hits: { grant: PaletteGrant; score: number }[] = [];
	for (const grant of grants) {
		const score = grantScore(grant, q);
		if (score !== null) hits.push({ grant, score });
	}
	const rows: PaletteRow[] = [];
	for (const [label, group] of [
		["Skills", "skill"],
		["MCP servers", "mcp"],
	] as const) {
		const list = hits.filter((hit) => hit.grant.group === group).sort((a, b) => b.score - a.score || a.grant.name.localeCompare(b.grant.name));
		if (list.length === 0) continue;
		rows.push({ kind: "header", label });
		for (const hit of list) rows.push({ kind: "grant", grant: hit.grant });
	}
	return rows;
}
