import type { BootMark } from "@milu/protocol";

const LIMIT_MS = 8000;

const marks: BootMark[] = [];
let report: ((marks: readonly BootMark[]) => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let sent = false;

export function reportBootTo(send: (marks: readonly BootMark[]) => void): void {
	report = send;
	if (marks.length > 0 && !sent && !landed()) timer = setTimeout(sendMarks, LIMIT_MS);
}

export function mark(name: string): void {
	if (sent || marks.some((each) => each.name === name)) return;
	marks.push({ name, at: Date.now() });
	if (landed()) {
		sendMarks();
		return;
	}
	clearTimeout(timer);
	timer = setTimeout(sendMarks, LIMIT_MS);
}

function landed(): boolean {
	return marks.some((each) => each.name === "data" || each.name === "list");
}

function sendMarks(): void {
	if (sent) return;
	sent = true;
	clearTimeout(timer);
	report?.(marks);
}
