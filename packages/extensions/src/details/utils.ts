const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const pad = (value: number) => String(value).padStart(2, "0");

export function clockOf(date: Date): string {
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function stampOf(date: Date, now = Date.now()): string {
	return `${MONTHS[date.getMonth()]} ${date.getDate()}${date.getFullYear() === new Date(now).getFullYear() ? "" : ` ${date.getFullYear()}`}`;
}

export function convTime(ts: number): string {
	const date = new Date(ts);
	return date.toDateString() === new Date().toDateString() ? clockOf(date) : stampOf(date);
}

export function clockTime(ts: number | null): string {
	if (ts === null) return "—";
	const date = new Date(ts);
	return `${date.getMonth() + 1}/${date.getDate()} ${clockOf(date)}`;
}

export function formatDate(ts: number): string {
	if (!ts) return "unknown";
	const date = new Date(ts);
	return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function formatTokens(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
	return String(Math.round(value));
}

export function digits(value: number): string {
	return Math.round(value).toLocaleString("en-US");
}

export function percent(value: number): string {
	return `${value.toFixed(1)}%`;
}

export function formatSize(value: number): string {
	return value <= 0 ? "0 B" : formatBytes(value);
}

export function formatBytes(value: number): string {
	if (value <= 0) return "—";
	if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
	if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
	if (value >= 1024) return `${Math.round(value / 1024)} KB`;
	return `${Math.round(value)} B`;
}

export function seconds(value: number): string {
	return `${(value / 1000).toFixed(1)}s`;
}

export function tokensPerSecond(value: number): string {
	return `${Math.round(value)} tok/s`;
}
