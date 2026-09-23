import { createStore } from "zustand/vanilla";

export type ToastVariant = "default" | "error";

export interface ToastItem {
	id: number;
	title?: string;
	body: string;
	variant: ToastVariant;
	onClick?: () => void;
	action?: { label: string; onClick: () => void };
	avatar?: string;
	leaving?: boolean;
}

export type ToastMessage = string | { title?: string; body: string; onClick?: () => void; action?: { label: string; onClick: () => void }; avatar?: string; durationMs?: number };

export const DEFAULT_TOAST_DURATION_MS = 4000;
export const TOAST_EXIT_MS = 160;

let nextToastId = 1;

function prefersReducedMotion(): boolean {
	return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function createToast() {
	const store = createStore<{ toasts: ToastItem[] }>()(() => ({ toasts: [] }));
	const timers = new Map<number, ReturnType<typeof setTimeout>>();
	const leavingIds = new Set<number>();
	let durationMs = DEFAULT_TOAST_DURATION_MS;

	function setDurationMs(ms: number) {
		durationMs = ms;
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
		store.setState((state) => ({ toasts: [...state.toasts, item] }));
		const lifetime = typeof message === "string" ? durationMs : (message.durationMs ?? durationMs);
		if (lifetime > 0) {
			timers.set(
				id,
				setTimeout(() => dismiss(id), lifetime),
			);
		}
		return id;
	}

	function dismiss(id: number) {
		const timer = timers.get(id);
		if (timer !== undefined) {
			clearTimeout(timer);
			timers.delete(id);
		}
		if (leavingIds.has(id)) return;
		leavingIds.add(id);
		store.setState((state) => ({ toasts: state.toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x)) }));
		setTimeout(
			() => {
				leavingIds.delete(id);
				store.setState((state) => ({ toasts: state.toasts.filter((x) => x.id !== id) }));
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
		store.setState({ toasts: [] });
	}

	return { store, push, dismiss, dismissAll, setDurationMs };
}

export type Toast = ReturnType<typeof createToast>;
