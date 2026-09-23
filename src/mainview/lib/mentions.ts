/**
 * The `@` picker's filter. Pure, no DOM, and no scoring beyond what a person can predict: a name
 * that starts with what you typed, then a name that contains it — the store's order (recently
 * active first) breaks ties.
 */

export interface MentionTarget {
	name: string;
}

export function filterMentions<T extends MentionTarget>(partners: readonly T[], query: string): T[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...partners];
	const rank = (partner: T): number => {
		const name = partner.name.toLowerCase();
		if (name.startsWith(q)) return 0;
		if (name.includes(q)) return 1;
		return -1;
	};
	return partners
		.map((partner, index) => ({ partner, index, at: rank(partner) }))
		.filter((hit) => hit.at >= 0)
		.sort((a, b) => a.at - b.at || a.index - b.index)
		.map((hit) => hit.partner);
}
