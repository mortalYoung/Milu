export interface DiffCell {
	readonly number: number | null;
	readonly text: string;
	readonly tone: "same" | "del" | "add" | "none";
}

export interface DiffLine {
	readonly left: DiffCell;
	readonly right: DiffCell;
}

export type SplitRow = ({ readonly kind: "line" } & DiffLine) | { readonly kind: "gap"; readonly count: number; readonly lines: readonly DiffLine[] };

const CONTEXT = 3;
const GAP_MIN = 4;
const MAX_CELLS = 4_000_000;

const NONE: DiffCell = { number: null, text: "", tone: "none" };

/** A trailing newline is not a line; a file that is only one is one empty line. */
function linesOf(text: string): string[] {
	if (text === "") return [];
	const lines = text.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function table(left: readonly string[], right: readonly string[]): Uint32Array[] | null {
	if (left.length * right.length > MAX_CELLS) return null;
	const rows = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
	for (let i = left.length - 1; i >= 0; i -= 1) {
		const row = rows[i]!;
		const next = rows[i + 1]!;
		for (let j = right.length - 1; j >= 0; j -= 1) row[j] = left[i] === right[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
	}
	return rows;
}

function same(i: number, j: number, left: readonly string[], right: readonly string[]): DiffLine {
	return { left: { number: i + 1, text: left[i]!, tone: "same" }, right: { number: j + 1, text: right[j]!, tone: "same" } };
}

/**
 * The two sides aligned row by row, with long unchanged runs folded into a gap that carries what it
 * hid. Null when the pairing would cost more cells than a two-sided view is worth.
 */
export function splitDiff(original: string, modified: string): readonly SplitRow[] | null {
	const left = linesOf(original);
	const right = linesOf(modified);

	let head = 0;
	while (head < left.length && head < right.length && left[head] === right[head]) head += 1;
	let tail = 0;
	while (tail < left.length - head && tail < right.length - head && left[left.length - 1 - tail] === right[right.length - 1 - tail]) tail += 1;

	const bodyLeft = left.slice(head, left.length - tail);
	const bodyRight = right.slice(head, right.length - tail);
	const lcs = table(bodyLeft, bodyRight);
	if (lcs === null) return null;

	const flat: DiffLine[] = [];
	for (let at = 0; at < head; at += 1) flat.push(same(at, at, left, right));
	let i = 0;
	let j = 0;
	while (i < bodyLeft.length && j < bodyRight.length) {
		if (bodyLeft[i] === bodyRight[j]) {
			flat.push(same(head + i, head + j, left, right));
			i += 1;
			j += 1;
			continue;
		}
		const dels: number[] = [];
		const adds: number[] = [];
		while (i < bodyLeft.length && j < bodyRight.length && bodyLeft[i] !== bodyRight[j]) {
			if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
				dels.push(i);
				i += 1;
			} else {
				adds.push(j);
				j += 1;
			}
		}
		for (let k = 0; k < Math.max(dels.length, adds.length); k += 1) {
			const old = dels[k];
			const next = adds[k];
			flat.push({
				left: old === undefined ? NONE : { number: head + old + 1, text: bodyLeft[old]!, tone: "del" },
				right: next === undefined ? NONE : { number: head + next + 1, text: bodyRight[next]!, tone: "add" },
			});
		}
	}
	for (; i < bodyLeft.length; i += 1) flat.push({ left: { number: head + i + 1, text: bodyLeft[i]!, tone: "del" }, right: NONE });
	for (; j < bodyRight.length; j += 1) flat.push({ left: NONE, right: { number: head + j + 1, text: bodyRight[j]!, tone: "add" } });
	for (let at = 0; at < tail; at += 1) flat.push(same(head + bodyLeft.length + at, head + bodyRight.length + at, left, right));

	const unchanged = (line: DiffLine): boolean => line.left.tone === "same" && line.right.tone === "same";
	const rows: SplitRow[] = [];
	let at = 0;
	while (at < flat.length) {
		if (!unchanged(flat[at]!)) {
			rows.push({ kind: "line", ...flat[at]! });
			at += 1;
			continue;
		}
		let end = at;
		while (end < flat.length && unchanged(flat[end]!)) end += 1;
		const run = flat.slice(at, end);
		const lead = at === 0 ? 0 : CONTEXT;
		const trail = end === flat.length ? 0 : CONTEXT;
		const hidden = run.length - lead - trail;
		if (hidden < GAP_MIN) {
			for (const line of run) rows.push({ kind: "line", ...line });
		} else {
			for (const line of run.slice(0, lead)) rows.push({ kind: "line", ...line });
			rows.push({ kind: "gap", count: hidden, lines: run.slice(lead, lead + hidden) });
			for (const line of run.slice(lead + hidden)) rows.push({ kind: "line", ...line });
		}
		at = end;
	}
	return rows;
}
