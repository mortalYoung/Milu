import { SLOT_POINTS, type SlotItem } from "@milu/protocol";
import type { Host } from "@milu/window";
import type { SlotProps } from "@milu/window/api";
import { Tip } from "@milu/window/tooltip";
import { Ellipsis } from "lucide-react";
import { type ComponentType, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { PanelLeftOpenIcon } from "./icons.tsx";

const NO_ITEMS: readonly never[] = [];
const BAR_KEEP = 2;
const BAR_COMPACT = 460;

function BarOverflow(props: { host: Host; items: readonly SlotItem[]; components: ReadonlyMap<string, ComponentType<SlotProps>> }) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node) || root.current?.contains(target) === true) return;
			setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	return (
		<div className="bar-overflow" ref={root}>
			<Tip label="More tools">
				<button type="button" className={`bar-icon${open ? " on" : ""}`} aria-label="More tools" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
					<Ellipsis size={16} />
				</button>
			</Tip>
			{open ? (
				<div className="bar-overflow-menu" role="menu" onClick={() => setOpen(false)}>
					{props.items.map((item) => {
						const Component = props.components.get(item.component);
						return Component ? <Component key={item.id} host={props.host} data={item.data} /> : null;
					})}
				</div>
			) : null}
		</div>
	);
}

export function ChatBar(props: { host: Host }) {
	const { host } = props;
	const columns = useStore(host.columns.store, (state) => state.columns);
	const linked = useStore(host.connection.store, (state) => state.linked);
	const items = useStore(host.slots.store, (state) => state.points[SLOT_POINTS.chatBar] ?? NO_ITEMS);
	const nameItems = useStore(host.slots.store, (state) => state.points[SLOT_POINTS.chatName] ?? NO_ITEMS);
	const components = useStore(host.slots.store, (state) => state.components);

	const name = useStore(host.selection.store, (state) => state.selected);
	const dockVisible = useStore(host.dock.store, (state) => state.visible);

	useEffect(() => {
		void host.slots.load(SLOT_POINTS.chatName, name || undefined);
	}, [host, name]);
	const [narrow, setNarrow] = useState(false);
	const bar = useRef<HTMLElement>(null);
	const lead = useRef<HTMLDivElement>(null);
	const tools = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const header = bar.current;
		const left = lead.current;
		const right = tools.current;
		if (header === null || left === null || right === null) return;
		let side = 0;
		let compact = false;
		const measure = (): void => {
			const box = header.getBoundingClientRect();
			const leadEdge = left.getBoundingClientRect().right - box.left + 8;
			const toolsEdge = box.right - right.getBoundingClientRect().left + 8;
			const next = Math.ceil(Math.max(leadEdge, toolsEdge));
			if (next !== side) {
				side = next;
				header.style.setProperty("--bar-side", `${next}px`);
			}
			const tight = box.width < BAR_COMPACT;
			if (tight !== compact) {
				compact = tight;
				setNarrow(tight);
			}
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(header);
		observer.observe(left);
		observer.observe(right);
		return () => observer.disconnect();
	}, [host]);

	const ordered = useMemo(() => [...items].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)), [items]);
	const split = Math.max(0, ordered.length - BAR_KEEP);
	const low = ordered.slice(0, split);
	const high = ordered.slice(split);

	const running = useStore(host.sessions.store, (state) => state.rows.find((row) => row.name === name)?.running ?? false);
	const compacting = useStore(host.sessions.store, (state) => state.rows.find((row) => row.name === name)?.compacting ?? false);
	const bare = name === "";

	return (
		<header className={`${columns.list.mode === "flow" ? "chat-bar" : "chat-bar at-edge"}${bare ? " is-bare" : ""}`} ref={bar}>
			<div className="chat-bar-lead" ref={lead}>
				{columns.list.mode === "collapsed" ? (
					<Tip label="Show chat list (⌘B)">
						<button type="button" className="bar-icon list-expand" aria-label="Show chat list" onClick={() => host.columns.toggleList()}>
							<PanelLeftOpenIcon size={16} />
						</button>
					</Tip>
				) : null}
			</div>

			{bare ? null : (
				<div className="chat-bar-name">
					<Tip label="View details (⌘E)">
						<button type="button" className="chat-bar-name-text" aria-label={`${name} — view details`} onClick={() => void host.actions.invoke("details.session", name)}>
							<span>{name}</span>
						</button>
					</Tip>
					{compacting ? (
						<span className="chat-bar-status">
							<span className="work-ring" />
							Compacting…
						</span>
					) : running ? (
						<span className="chat-bar-status">
							<span className="work-dot" />
							<span className="work-dot" />
							<span className="work-dot" />
							Writing…
						</span>
					) : null}
					{nameItems.map((item) => {
						const Component = components.get(item.component);
						return Component ? <Component key={item.id} host={host} data={item.data} /> : null;
					})}
				</div>
			)}

			<div className="chat-bar-tools" ref={tools}>
				{narrow ? (
					low.length === 0 ? null : (
						<BarOverflow host={host} items={low} components={components} />
					)
				) : (
					low.map((item) => {
						const Component = components.get(item.component);
						return Component ? <Component key={item.id} host={host} data={item.data} /> : null;
					})
				)}
				{high.map((item) => {
					const Component = components.get(item.component);
					return Component ? <Component key={item.id} host={host} data={item.data} /> : null;
				})}
				{linked ? null : (
					<Tip label="Disconnected">
						<span className="dot off" />
					</Tip>
				)}
				{dockVisible ? null : <span className="bar-sep" aria-hidden="true" />}
			</div>
		</header>
	);
}
