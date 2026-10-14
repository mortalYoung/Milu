import { fuzzyScore } from "../../shared/fuzzy";
import type { PartnerItem } from "./session";

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

/**
 * An instant on a timeline (a memory run, a schedule's ETA): today → "10:42", otherwise → "JUL 28".
 * Future instants stay dates — "next …" must never read as "3d ago".
 */
export function convTime(ts: number): string {
	const d = new Date(ts);
	return d.toDateString() === new Date().toDateString() ? clockOf(d) : stampOf(d, Date.now());
}

export interface NextRunParts {
	/** `OCT 15` (the year joins in when it is not this one), or empty for today. */
	day: string;
	/** How many days out, when it is not today; the caller draws it as a subscript. */
	offset: number | null;
	clock: string;
}

/** When a schedule fires next, in three parts: today is the clock alone, otherwise `OCT 15 ₊₁ 10:30`. */
export function describeNextRun(ts: number, now = Date.now()): NextRunParts {
	const d = new Date(ts);
	const days = -dayGap(ts, now);
	const clock = clockOf(d);
	if (days === 0) return { day: "", offset: null, clock };
	const day = stampOf(d, now);
	return { day, offset: days > 0 ? days : null, clock };
}

/**
 * A list row's recency (chat rows, ⌘K rows): today → "10:42", within thirty days → "3d ago",
 * older → "JUL 28" (with the year when it is not this one).
 */
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

/**
 * A row's time: the last message, else when the current session began (a cleared chat has no
 * message left but was just touched), else the profile's birthday. Never the retired log's date.
 */
export function activityAt(partner: PartnerItem): number {
	return partner.lastMessageAt ?? partner.startedAt ?? partner.createdAt;
}

/** The row's preview: the last visible row when there is one, else the profile note, else a placeholder. */
export function previewFor(partner: PartnerItem): string {
	if (partner.lastMessage) {
		const text = oneLine(partner.lastMessage);
		if (partner.lastMessageKind === "user") return `You: ${text}`;
		if (partner.lastMessageKind === "command") return `/${text}`;
		if (partner.lastMessageKind === "skill") return `/skill:${text}`;
		if (partner.lastMessageKind === "shell") return `$ ${text}`;
		return text;
	}
	return partner.persona?.split("\n").find((l) => l.trim()) ?? "";
}

/**
 * The one partner matcher, shared by the palette's Sessions mode and the chat list's filter: name,
 * workspace and persona are each fuzzy-scored; a name hit outranks everything, then the score,
 * then workspace, then persona, and the most recently active chat breaks the tie.
 */
export function filterPartners(partners: PartnerItem[], query: string): PartnerItem[] {
	const q = query.trim();
	if (!q) return [...partners].sort((a, b) => activityAt(b) - activityAt(a) || a.name.localeCompare(b.name));
	const hits: { partner: PartnerItem; name: number | null; persona: number | null; workspace: number | null }[] = [];
	for (const partner of partners) {
		const name = fuzzyScore(q, partner.name);
		const persona = partner.persona ? fuzzyScore(q, partner.persona) : null;
		const workspace = partner.workspace ? fuzzyScore(q, partner.workspace) : null;
		if (name !== null || persona !== null || workspace !== null) hits.push({ partner, name, persona, workspace });
	}
	hits.sort(
		(a, b) =>
			Number(b.name !== null) - Number(a.name !== null) ||
			(b.name ?? 0) - (a.name ?? 0) ||
			(b.workspace ?? 0) - (a.workspace ?? 0) ||
			(b.persona ?? 0) - (a.persona ?? 0) ||
			activityAt(b.partner) - activityAt(a.partner),
	);
	return hits.map(({ partner }) => partner);
}
