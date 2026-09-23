import { X } from "lucide-react";
import type { ToastPlacement } from "../../shared/rpc";
import type { ToastItem } from "../lib/toast";
import { Avatar } from "./ui/avatar";

const PLACEMENT: Record<ToastPlacement, { host: string; anim: string; out: string }> = {
	topcenter: { host: "toast-host-topcenter", anim: "toast-in-top", out: "toast-out-top" },
	topright: { host: "toast-host-topright", anim: "toast-in-right", out: "toast-out-right" },
	bottomcenter: { host: "toast-host-bottomcenter", anim: "toast-in-bottom", out: "toast-out-bottom" },
	bottomright: { host: "toast-host-bottomright", anim: "toast-in-right", out: "toast-out-right" },
};

function toastStyle(placement: ToastPlacement): "tooltip" | "notification" {
	return placement === "topcenter" || placement === "bottomcenter" ? "tooltip" : "notification";
}

export function ToastHost(props: { toasts: readonly ToastItem[]; placement: ToastPlacement; onDismiss: (id: number) => void }) {
	const placement = PLACEMENT[props.placement] ?? PLACEMENT.bottomcenter;
	const style = toastStyle(props.placement);
	return (
		<div className={`toast-host ${placement.host} toast-host--${style}`}>
			{props.toasts.map((toast) => (
				<div
					key={toast.id}
					className={`toast toast--${style} ${toast.leaving ? placement.out : placement.anim}` + (toast.variant === "error" ? " toast-error" : "")}
					role={toast.variant === "error" ? "alert" : "status"}
					onClick={() => style === "tooltip" && props.onDismiss(toast.id)}
				>
					{style === "tooltip" ? (
						<span className="toast-body">{toast.body}</span>
					) : (
						<>
							{toast.avatar && <Avatar name={toast.avatar ?? ""} size="sm" variant="ink" />}
							<div className={"toast-content" + (toast.onClick ? " toast-content--actionable" : "")} onClick={() => toast.onClick?.()}>
								{toast.title && <h2 className="toast-title">{toast.title}</h2>}
								<p className="toast-body">{toast.body}</p>
							</div>
							{toast.action && (
								<button
									type="button"
									className="toast-action"
									onClick={(event) => {
										event.stopPropagation();
										toast.action?.onClick();
									}}
								>
									{toast.action.label}
								</button>
							)}
							<button type="button" className="toast-close" aria-label="Close toast" onClick={() => props.onDismiss(toast.id)}>
								<X size={14} />
							</button>
						</>
					)}
				</div>
			))}
		</div>
	);
}
