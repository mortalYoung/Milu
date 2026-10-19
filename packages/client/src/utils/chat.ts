import type { SessionRow } from "@milu/protocol";

/** Case-insensitive subsequence match with a light score: consecutive runs, segment starts and short haystacks win. */
const BOUNDARY = /[/\-_. ]/;

export function fuzzyScore(needle: string, haystack: string): number | null {
	const n = needle.trim().toLowerCase();
	if (!n) return 0;
	const h = haystack.toLowerCase();
	let score = 0;
	let from = 0;
	let previous = -2;
	for (const ch of n) {
		const at = h.indexOf(ch, from);
		if (at === -1) return null;
		score += at === previous + 1 ? 8 : 1;
		if (at === 0 || BOUNDARY.test(h[at - 1] ?? "")) score += 6;
		previous = at;
		from = at + 1;
	}
	return score - (Math.min(h.length, 120) >> 2);
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const pad = (n: number) => String(n).padStart(2, "0");

const clockOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** `JUL 28`, with the year when it is not this one — a date with no year is a lie three years later. */
function stampOf(d: Date, now: number): string {
	return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === new Date(now).getFullYear() ? "" : ` ${d.getFullYear()}`}`;
}

/** Whole days between the two calendar dates: today is 0, yesterday is 1, and DST does not shift it. */
function dayGap(ts: number, now: number): number {
	const from = new Date(ts);
	from.setHours(0, 0, 0, 0);
	const to = new Date(now);
	to.setHours(0, 0, 0, 0);
	return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** A list row's recency: today → "10:42", within thirty days → "3d ago", older → "JUL 28". */
export function listTime(ts: number, now = Date.now()): string {
	const d = new Date(ts);
	const days = dayGap(ts, now);
	if (days === 0) return clockOf(d);
	if (days >= 1 && days <= 30) return `${days}d ago`;
	return stampOf(d, now);
}

/** Single-line preview for a list row: collapse newlines/whitespace so the truncate ellipsis works. */
export function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** A row's time: the last message, else when the current log began, else the profile's birthday. */
export function activityAt(row: SessionRow): number {
	return row.lastMessageAt ?? row.startedAt ?? row.createdAt;
}

/** The row's preview, with the prefix that tells you who said it. */
export function previewFor(row: SessionRow): string {
	if (row.lastMessage) {
		const text = oneLine(row.lastMessage);
		if (row.lastMessageKind === "user") return `You: ${text}`;
		if (row.lastMessageKind === "command") return `/${text}`;
		if (row.lastMessageKind === "skill") return `/skill:${text}`;
		if (row.lastMessageKind === "shell") return `$ ${text}`;
		return text;
	}
	return row.persona?.split("\n").find((line) => line.trim()) ?? "";
}

/** Pinned sessions first, then recency — the one ordering rule the list and the palette share. */
export const byPinThenRecency = (a: SessionRow, b: SessionRow) =>
	Number(b.pinned === true) - Number(a.pinned === true) || activityAt(b) - activityAt(a) || a.name.localeCompare(b.name);

/**
 * The one chat matcher: name, workspace and persona are each fuzzy-scored; a name hit outranks
 * everything, then the score, then workspace, then persona, and the most recently active breaks ties.
 */
export function filterSessions(rows: readonly SessionRow[], query: string): SessionRow[] {
	const q = query.trim();
	if (!q) return [...rows].sort(byPinThenRecency);
	const hits: { row: SessionRow; name: number | null; persona: number | null; workspace: number | null }[] = [];
	for (const row of rows) {
		const name = fuzzyScore(q, row.name);
		const persona = row.persona ? fuzzyScore(q, row.persona) : null;
		const workspace = row.workspace ? fuzzyScore(q, row.workspace) : null;
		if (name !== null || persona !== null || workspace !== null) hits.push({ row, name, persona, workspace });
	}
	hits.sort(
		(a, b) =>
			Number(b.name !== null) - Number(a.name !== null) ||
			(b.name ?? 0) - (a.name ?? 0) ||
			(b.workspace ?? 0) - (a.workspace ?? 0) ||
			(b.persona ?? 0) - (a.persona ?? 0) ||
			activityAt(b.row) - activityAt(a.row),
	);
	return hits.map(({ row }) => row);
}

/** A row's workspace label: the repo's name (a linked worktree says so with its icon), or the path. */
export function workspaceLabel(row: SessionRow): string {
	if (row.workspace && (row.workspaceKind === "worktree" || row.workspaceKind === "repo") && row.workspaceRepo) return row.workspaceRepo;
	return formatWorkspacePath(row.workspace ?? "", 30);
}

export function formatWorkspacePath(path: string, max = 48): string {
	if (path.length <= max) return path;
	const head = path.slice(0, Math.ceil(max * 0.45));
	const tail = path.slice(-Math.floor(max * 0.45));
	return `${head}…${tail}`;
}
