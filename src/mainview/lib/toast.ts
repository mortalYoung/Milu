import { createSignal } from "solid-js";

export type ToastVariant = "default" | "error";

export interface ToastItem {
	id: number;
	title?: string;
	body: string;
	variant: ToastVariant;
	onClick?: () => void;
	/** Partner initial shown in the notification avatar (identity anchor). */
	avatar?: string;
	/** Set while the toast is playing its exit animation; removed after it finishes. */
	leaving?: boolean;
}

export type ToastMessage = string | { title?: string; body: string; onClick?: () => void; avatar?: string };

export const DEFAULT_TOAST_DURATION_MS = 4000;
export const TOAST_EXIT_MS = 160;

let nextToastId = 1;

function prefersReducedMotion(): boolean {
	return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function createToast(getDurationMs: () => number = () => DEFAULT_TOAST_DURATION_MS) {
	const [toasts, setToasts] = createSignal<ToastItem[]>([]);
	const timers = new Map<number, ReturnType<typeof setTimeout>>();
	const leavingIds = new Set<number>();
	let durationMs = getDurationMs;

	function setDurationMs(ms: number) {
		durationMs = () => ms;
	}

	function push(message: ToastMessage, variant: ToastVariant = "default") {
		const id = nextToastId++;
		const base = typeof message === "string" ? { body: message } : message;
		const item: ToastItem = { id, ...base, variant };
		if (base.onClick) {
			const action = base.onClick;
			item.onClick = () => {
				action();
				dismiss(id);
			};
		}
		setToasts((t) => [...t, item]);
		const duration = durationMs();
		if (duration > 0) {
			timers.set(
				id,
				setTimeout(() => dismiss(id), duration),
			);
		}
	}

	function dismiss(id: number) {
		const timer = timers.get(id);
		if (timer !== undefined) {
			clearTimeout(timer);
			timers.delete(id);
		}
		if (leavingIds.has(id)) return;
		leavingIds.add(id);
		setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
		window.setTimeout(
			() => {
				leavingIds.delete(id);
				setToasts((t) => t.filter((x) => x.id !== id));
			},
			prefersReducedMotion() ? 0 : TOAST_EXIT_MS,
		);
	}

	function dismissAll() {
		for (const id of timers.keys()) {
			clearTimeout(timers.get(id));
			timers.delete(id);
		}
		leavingIds.clear();
		setToasts([]);
	}

	return { toasts, push, dismiss, dismissAll, setDurationMs };
}
