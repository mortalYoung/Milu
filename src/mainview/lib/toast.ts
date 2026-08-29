import { createSignal } from "solid-js";

export type ToastVariant = "default" | "error";

export interface ToastItem {
	id: number;
	title?: string;
	body: string;
	variant: ToastVariant;
	onClick?: () => void;
}

export type ToastMessage = string | { title?: string; body: string; onClick?: () => void };

export const DEFAULT_TOAST_DURATION_MS = 4000;

let nextToastId = 1;

export function createToast(getDurationMs: () => number = () => DEFAULT_TOAST_DURATION_MS) {
	const [toasts, setToasts] = createSignal<ToastItem[]>([]);
	const timers = new Map<number, ReturnType<typeof setTimeout>>();

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
		const duration = getDurationMs();
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
		setToasts((t) => t.filter((x) => x.id !== id));
	}

	return { toasts, push, dismiss };
}
