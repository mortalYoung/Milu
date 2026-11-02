import type { Notification, SurfaceProps } from "@milu/window/api";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

const EXIT_MS = 260;

function clockOf(at: number): string {
	const date = new Date(at);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function LedgerRow(props: { item: Notification; duration: number; leaving: boolean; onDismiss: (id: number) => void; onOpen: (id: number, session: string) => void }) {
	const [entered, setEntered] = useState(false);

	useEffect(() => {
		let second = 0;
		const first = window.requestAnimationFrame(() => {
			second = window.requestAnimationFrame(() => setEntered(true));
		});
		return () => {
			window.cancelAnimationFrame(first);
			window.cancelAnimationFrame(second);
		};
	}, []);

	const title = props.item.title ?? props.item.body;
	const body = props.item.title === undefined ? null : <p className="ledger-body">{props.item.body}</p>;
	const state = `${entered ? " is-in" : ""}${props.leaving ? " is-leaving" : ""}`;
	const session = props.item.session;
	const content = (
		<>
			<span className="ledger-time">{clockOf(props.item.createdAt)}</span>
			<div className="ledger-main">
				<div className="ledger-title">{title}</div>
				{body}
			</div>
		</>
	);

	return (
		<div className={`ledger-row-wrap${state}`}>
			<div
				className={`ledger-row${props.item.tone === "error" ? " is-error" : ""}${session === undefined ? "" : " is-link"}`}
				role={props.item.tone === "error" ? "alert" : "status"}
			>
				{session === undefined ? (
					content
				) : (
					<button type="button" className="ledger-open" onClick={() => props.onOpen(props.item.id, session)}>
						{content}
					</button>
				)}
				<button type="button" className="ledger-close" aria-label="Dismiss" onClick={() => props.onDismiss(props.item.id)}>
					×
				</button>
				{props.duration > 0 ? <span className="ledger-progress" style={{ animationDuration: `${props.duration}ms` }} /> : null}
			</div>
		</div>
	);
}

export function ToastOverlay(props: SurfaceProps) {
	const { host } = props;
	const items = useStore(host.notifications.store, (state) => state.items);
	const [settings, setSettings] = useState<ToastSettings>({ placement: DEFAULT_TOAST_PLACEMENT, durationMs: DEFAULT_TOAST_DURATION_MS });
	const [leaving, setLeaving] = useState<ReadonlySet<number>>(() => new Set());
	const leavingRef = useRef(new Set<number>());
	const timers = useRef(new Map<number, number>());
	const exits = useRef(new Map<number, number>());
	const armedFor = useRef<number | null>(null);
	const rows = useRef<HTMLDivElement>(null);
	const previousNewest = useRef<number | undefined>(undefined);
	const newest = items[items.length - 1]?.id;

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

	const beginDismiss = useCallback(
		(id: number) => {
			if (leavingRef.current.has(id)) return;
			const timer = timers.current.get(id);
			if (timer !== undefined) {
				window.clearTimeout(timer);
				timers.current.delete(id);
			}
			leavingRef.current.add(id);
			setLeaving(new Set(leavingRef.current));
			const exit = window.setTimeout(() => {
				host.notifications.dismiss(id);
				leavingRef.current.delete(id);
				exits.current.delete(id);
				setLeaving(new Set(leavingRef.current));
			}, EXIT_MS);
			exits.current.set(id, exit);
		},
		[host],
	);

	const clearAll = useCallback(() => {
		const live = host.notifications.store.getState().items;
		for (const item of live) beginDismiss(item.id);
	}, [beginDismiss, host]);

	const open = useCallback(
		(id: number, session: string) => {
			void host.selection.select(session);
			beginDismiss(id);
		},
		[beginDismiss, host],
	);

	useEffect(() => {
		const live = new Set(items.map((item) => item.id));
		const rearm = armedFor.current !== settings.durationMs;
		for (const [id, timer] of timers.current) {
			if (!rearm && live.has(id)) continue;
			window.clearTimeout(timer);
			timers.current.delete(id);
		}
		armedFor.current = settings.durationMs;
		if (settings.durationMs <= 0) return;
		for (const item of items) {
			if (leavingRef.current.has(item.id) || timers.current.has(item.id)) continue;
			timers.current.set(
				item.id,
				window.setTimeout(() => beginDismiss(item.id), settings.durationMs),
			);
		}
	}, [beginDismiss, items, settings.durationMs]);

	useEffect(() => {
		const running = timers.current;
		const exiting = exits.current;
		return () => {
			for (const timer of running.values()) window.clearTimeout(timer);
			for (const timer of exiting.values()) window.clearTimeout(timer);
			running.clear();
			exiting.clear();
		};
	}, []);

	useEffect(() => {
		if (newest !== undefined && newest !== previousNewest.current) rows.current?.scrollTo({ top: 0 });
		previousNewest.current = newest;
	}, [newest]);

	if (items.length === 0) return null;

	const ordered = [...items].reverse();
	const visible = Math.max(0, items.length - leaving.size);
	const allLeaving = items.every((item) => leaving.has(item.id));
	const bottom = settings.placement === "bottomright";

	return (
		<div className={`fixed z-[80] flex flex-col items-end pointer-events-none ${HOST[settings.placement]}`} aria-live="polite">
			<div className={`ledger${bottom ? " is-bottom" : ""}${allLeaving ? " is-leaving" : ""}`}>
				<div className="ledger-head">
					<span>Notifications</span>
					<span className="ledger-count is-bumped" key={visible}>
						{visible}
					</span>
					<button type="button" className="ledger-clear" aria-label="Clear all notifications" title="Clear all" onClick={clearAll}>
						<Trash2 size={12} strokeWidth={1.7} />
					</button>
				</div>
				<div className="ledger-rows" ref={rows}>
					{ordered.map((item) => (
						<LedgerRow key={item.id} item={item} duration={settings.durationMs} leaving={leaving.has(item.id)} onDismiss={beginDismiss} onOpen={open} />
					))}
				</div>
			</div>
		</div>
	);
}

export default ToastOverlay;
