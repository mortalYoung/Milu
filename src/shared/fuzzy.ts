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
		if (at === 0 || BOUNDARY.test(h[at - 1])) score += 6;
		previous = at;
		from = at + 1;
	}
	return score - (Math.min(h.length, 120) >> 2);
}
