import { createContext, type JSX, useContext } from "solid-js";
import type { createToast } from "../toast";

export type Toast = ReturnType<typeof createToast>;

const ToastContext = createContext<Toast | undefined>(undefined);

export function ToastProvider(props: { value: Toast; children?: JSX.Element }) {
	return <ToastContext.Provider value={props.value}>{props.children}</ToastContext.Provider>;
}

export function useToast(): Toast {
	const ctx = useContext(ToastContext);
	if (!ctx) throw new Error("useToast must be used within ToastProvider");
	return ctx;
}
