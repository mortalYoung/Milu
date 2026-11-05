import type { Extension } from "@milu/core";

export type ToastPlacement = "topright" | "bottomright";

export const DEFAULT_TOAST_PLACEMENT: ToastPlacement = "topright";
export const DEFAULT_TOAST_DURATION_MS = 4000;

export function placementOf(value: unknown): ToastPlacement {
	const text = String(value ?? "").toLowerCase();
	return text === "bottomright" ? "bottomright" : DEFAULT_TOAST_PLACEMENT;
}

export function durationOf(value: unknown): number {
	const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
	return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : DEFAULT_TOAST_DURATION_MS;
}

const notifyExtension: Extension = {
	id: "notify",
	apiVersion: 1,
	widgets: [{ id: "notify.toasts", type: "slot", entry: "./widget/toast.tsx", export: "ToastOverlay" }],

	contributions: {
		"chat.panes": [{ id: "notify", order: 20, component: "notify.toasts" }],
	},

	activate(context) {
		const placement = context.disposables.add(context.settings.declare({ key: "toastPlacement", defaults: DEFAULT_TOAST_PLACEMENT }));
		const duration = context.disposables.add(context.settings.declare({ key: "toastDurationMs", defaults: DEFAULT_TOAST_DURATION_MS }));

		context.actions.register({
			id: "notify.settings",
			run: () => ({
				data: {
					placement: placementOf(placement.get()),
					durationMs: durationOf(duration.get()),
				},
			}),
		});
	},
};

export default notifyExtension;
