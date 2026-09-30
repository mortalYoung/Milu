import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

const INTERACTIVE = "button, a, input, textarea, select, [contenteditable='true']";

/** True when a click landed on a real control: the pane around it must not steal focus or start a drag. */
export function isInteractive(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && target.closest(INTERACTIVE) != null;
}

export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return String(Math.round(n));
}

export function digits(n: number): string {
	return Math.round(n).toLocaleString("en-US");
}

export function percent(n: number): string {
	return `${n.toFixed(1)}%`;
}

export function formatBytes(n: number): string {
	if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
	if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
	if (n >= 1024) return `${Math.round(n / 1024)} KB`;
	return `${Math.round(n)} B`;
}
