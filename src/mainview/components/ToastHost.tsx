import { X } from "lucide-solid";
import { For, Show } from "solid-js";
import type { ToastPlacement } from "../../shared/rpc";
import type { ToastItem } from "../lib/toast";

const PLACEMENT: Record<ToastPlacement, { host: string; anim: string; out: string }> = {
	topcenter: { host: "toast-host-topcenter", anim: "toast-in-top", out: "toast-out-top" },
	topright: { host: "toast-host-topright", anim: "toast-in-right", out: "toast-out-right" },
	bottomcenter: { host: "toast-host-bottomcenter", anim: "toast-in-bottom", out: "toast-out-bottom" },
	bottomright: { host: "toast-host-bottomright", anim: "toast-in-right", out: "toast-out-right" },
};

function toastStyle(placement: ToastPlacement): "tooltip" | "notification" {
	return placement === "topcenter" || placement === "bottomcenter" ? "tooltip" : "notification";
}

export function ToastHost(props: { toasts: () => ToastItem[]; placement: ToastPlacement; onDismiss: (id: number) => void }) {
	const p = () => PLACEMENT[props.placement] ?? PLACEMENT.bottomcenter;
	const style = () => toastStyle(props.placement);
	return (
		<div class={`toast-host ${p().host} toast-host--${style()}`}>
			<For each={props.toasts()}>
				{(t) => (
					<div
						class={`toast toast--${style()} ${t.leaving ? p().out : p().anim}` + (t.variant === "error" ? " toast-error" : "")}
						role={t.variant === "error" ? "alert" : "status"}
						onClick={() => style() === "tooltip" && props.onDismiss(t.id)}
					>
						{style() === "tooltip" ? (
							<span class="toast-body">{t.body}</span>
						) : (
							<>
								<div class={"toast-content" + (t.onClick ? " toast-content--actionable" : "")} onClick={() => t.onClick?.()}>
									<Show when={t.title}>
										<h2 class="toast-title">{t.title}</h2>
									</Show>
									<p class="toast-body">{t.body}</p>
								</div>
								<button type="button" class="toast-close" aria-label="Close toast" onClick={() => props.onDismiss(t.id)}>
									<X size={14} />
								</button>
							</>
						)}
					</div>
				)}
			</For>
		</div>
	);
}
