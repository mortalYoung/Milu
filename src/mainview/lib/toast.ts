import { createSignal } from "solid-js";

export type ToastVariant = "default" | "error";

export interface ToastItem {
	id: number;
	text: string;
	variant: ToastVariant;
}

let nextToastId = 1;

export function createToast() {
	const [toasts, setToasts] = createSignal<ToastItem[]>([]);
	function push(text: string, variant: ToastVariant = "default") {
		const id = nextToastId++;
		setToasts((t) => [...t, { id, text, variant }]);
		setTimeout(() => dismiss(id), 4000);
	}
	function dismiss(id: number) {
		setToasts((t) => t.filter((x) => x.id !== id));
	}
	return { toasts, push, dismiss };
}
