import { createContext, type ReactNode, useContext } from "react";
import type { createToast } from "../toast";

export type ToastController = ReturnType<typeof createToast>;

const ToastContext = createContext<ToastController | undefined>(undefined);

export function ToastProvider(props: { value: ToastController; children?: ReactNode }) {
	return <ToastContext.Provider value={props.value}>{props.children}</ToastContext.Provider>;
}

export function useToast(): ToastController {
	const ctx = useContext(ToastContext);
	if (!ctx) throw new Error("useToast must be used within ToastProvider");
	return ctx;
}
