const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const pad = (value: number) => String(value).padStart(2, "0");

export function clockOf(at: number): string {
	const date = new Date(at);
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function whenOf(at: number, now = Date.now()): string {
	const date = new Date(at);
	if (date.toDateString() === new Date(now).toDateString()) return clockOf(at);
	return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function agoOf(at: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.round((now - at) / 1000));
	if (seconds < 90) return `${seconds}s ago`;
	if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
	if (seconds < 172_800) return `${Math.round(seconds / 3600)}h ago`;
	return `${Math.round(seconds / 86_400)}d ago`;
}

export function monthDay(iso: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
	if (match) return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}`;
	return iso;
}

export function bytesOf(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / 1_048_576).toFixed(1)} MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${bytes} B`;
}

export function secondsOf(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

export function linesOf(text: string): readonly string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}
