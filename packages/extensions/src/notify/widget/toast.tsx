import type { SurfaceProps } from "@milu/window/api";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { DEFAULT_TOAST_DURATION_MS, DEFAULT_TOAST_PLACEMENT, type ToastPlacement } from "../index.ts";

interface ToastSettings {
	readonly placement: ToastPlacement;
	readonly durationMs: number;
}

const HOST: Record<ToastPlacement, string> = {
	topright: "top-[calc(var(--bar-h)+12px)] right-6",
	bottomright: "bottom-[76px] right-6",
};

const CARD =
	"pointer-events-auto relative flex max-w-[min(360px,80vw)] animate-[toast-in_160ms_var(--ease-out)] items-center gap-2 overflow-hidden rounded-md border px-3 py-2 motion-reduce:animate-none";

export function ToastOverlay(props: SurfaceProps) {
	const { host } = props;
	const items = useStore(host.notifications.store, (state) => state.items);
	const [settings, setSettings] = useState<ToastSettings>({ placement: DEFAULT_TOAST_PLACEMENT, durationMs: DEFAULT_TOAST_DURATION_MS });
	const timers = useRef(new Map<number, number>());

	useEffect(() => {
		let alive = true;
		const load = () => {
			void host.actions
				.request<ToastSettings>("notify.settings")
				.then((next) => {
					if (alive && next) setSettings(next);
				})
				.catch(() => undefined);
		};
		load();
		const subscription = host.connection.onLive((event) => {
			if (event.type === "settings") load();
		});
		return () => {
			alive = false;
			subscription.dispose();
		};
	}, [host]);

	useEffect(() => {
		const live = new Set(items.map((item) => item.id));
		for (const [id, timer] of timers.current) {
			if (live.has(id)) continue;
			window.clearTimeout(timer);
			timers.current.delete(id);
		}
		if (settings.durationMs <= 0) return;
		for (const item of items) {
			if (timers.current.has(item.id)) continue;
			timers.current.set(
				item.id,
				window.setTimeout(() => host.notifications.dismiss(item.id), settings.durationMs),
			);
		}
	}, [host, items, settings.durationMs]);

	useEffect(() => {
		const running = timers.current;
		return () => {
			for (const timer of running.values()) window.clearTimeout(timer);
			running.clear();
		};
	}, []);

	if (items.length === 0) return null;

	return (
		<div className={`fixed z-[80] flex flex-col items-end gap-2 pointer-events-none ${HOST[settings.placement]}`} aria-live="polite">
			{items.map((item) => (
				<div
					key={item.id}
					role={item.tone === "error" ? "alert" : "status"}
					className={`${CARD} ${item.tone === "error" ? "border-signal bg-signal text-canvas" : "border-ink-soft/40 bg-surface text-ink shadow-[0_4px_12px_color-mix(in_srgb,var(--ink)_12%,transparent)]"}`}
				>
					{item.tone === "error" ? null : <span className="absolute inset-y-0 left-0 w-[3px] bg-ink" />}
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						{item.title ? <span className="text-[13px] font-medium leading-tight">{item.title}</span> : null}
						<span className={`line-clamp-1 text-[12px] leading-snug ${item.tone === "error" ? "text-canvas/80" : "text-muted"}`}>{item.body}</span>
					</div>
					<button
						type="button"
						className={`grid size-6 shrink-0 cursor-pointer place-items-center rounded border-0 bg-transparent p-0 ${item.tone === "error" ? "text-canvas/80 hover:text-canvas" : "text-muted hover:text-ink"}`}
						aria-label="Dismiss"
						onClick={() => host.notifications.dismiss(item.id)}
					>
						<X size={13} />
					</button>
				</div>
			))}
		</div>
	);
}

export default ToastOverlay;
