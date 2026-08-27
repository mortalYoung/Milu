import { For } from "solid-js";
import type { ToastPlacement } from "../../shared/rpc";
import type { ToastItem } from "../lib/toast";

const PLACEMENT: Record<ToastPlacement, { host: string; anim: string }> = {
	topcenter: { host: "toast-host-topcenter", anim: "toast-in-top" },
	topright: { host: "toast-host-topright", anim: "toast-in-right" },
	bottomcenter: { host: "toast-host-bottomcenter", anim: "toast-in-bottom" },
	bottomright: { host: "toast-host-bottomright", anim: "toast-in-right" },
};

export function ToastHost(props: { toasts: () => ToastItem[]; placement: ToastPlacement; onDismiss: (id: number) => void }) {
	const p = () => PLACEMENT[props.placement] ?? PLACEMENT.bottomcenter;
	return (
		<div class={`toast-host ${p().host}`}>
			<For each={props.toasts()}>
				{(t) => (
					<div class={`toast ${p().anim}` + (t.variant === "error" ? " toast-error" : "")} onClick={() => props.onDismiss(t.id)}>
						{t.text}
					</div>
				)}
			</For>
		</div>
	);
}
