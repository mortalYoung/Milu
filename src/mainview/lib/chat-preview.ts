import { fuzzyScore } from "../../shared/fuzzy";
import type { PartnerItem } from "./session";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Directory time: today → "10:42"; otherwise → "JUL 28" */
export function convTime(ts: number): string {
	const d = new Date(ts);
	if (d.toDateString() === new Date().toDateString()) {
		return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}
	return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
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
 * then workspace, then persona, and the most recently active letter breaks the tie.
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
