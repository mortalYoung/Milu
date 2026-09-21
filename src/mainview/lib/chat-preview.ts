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
