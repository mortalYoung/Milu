import type { Host } from "@milu/window";
import { Tip } from "@milu/window/tooltip";
import { type ReactNode, useEffect, useRef } from "react";
import { useStore } from "zustand";

import { DialogHost } from "./components/dialog-host.tsx";
import { Grip } from "./components/grip.tsx";
import { SessionListSkeleton, TranscriptSkeleton } from "./components/skeletons.tsx";

const WELCOME_SCOPES: ReadonlySet<string> = new Set(["welcome", "app"]);
const CHAT_SCOPES: ReadonlySet<string> = new Set(["chat", "app"]);

export function Workbench(props: { host: Host }) {
	const { host } = props;

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const selected = host.selection.store.getState().selected;
			const binding = host.hotkeys.match(
				{ key: event.key, code: event.code, shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, isComposing: event.isComposing },
				selected === "" ? WELCOME_SCOPES : CHAT_SCOPES,
			);
			if (binding) {
				event.preventDefault();
				void host.actions.invoke(binding.id, selected === "" ? undefined : selected);
				return;
			}
			if (!(event.metaKey || event.ctrlKey)) return;
			if (event.key === "f") {
				event.preventDefault();
				host.workbench.setSearch(true);
				return;
			}
			if (event.key === "b") {
				event.preventDefault();
				host.columns.toggleList();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [host]);

	const layout = useStore(host.layout.store);
	const columns = useStore(host.columns.store, (state) => state.columns);
	const arrived = useStore(host.sessions.store, (state) => state.arrived);
	const dockIds = layout.layout["dock"] ?? [];
	const row = useRef<HTMLDivElement>(null);

	useEffect(() => {
		document.getElementById("boot")?.remove();
	}, []);

	const readout = (dragged: "list" | "dock", width: number): string => {
		const laid = host.columns.layoutFor(dragged === "list" ? { list: width } : { dock: width });
		const parts: number[] = [];
		if (laid.list.mode === "flow") parts.push(laid.list.width);
		parts.push(laid.workbench);
		if (laid.dock.mode === "flow") parts.push(laid.dock.width);
		return parts.map((value) => Math.round(value)).join(" / ");
	};

	useEffect(() => {
		host.columns.setDockAvailable(dockIds.length > 0);
	}, [host, dockIds.length]);

	useEffect(() => {
		const element = row.current;
		if (!element) return;
		const observer = new ResizeObserver(() => host.columns.setRow(element.clientWidth));
		observer.observe(element);
		host.columns.setRow(element.clientWidth);
		return () => observer.disconnect();
	}, [host]);

	return (
		<div className="layout-row" ref={row}>
			<Column
				host={host}
				slot="sidebar"
				width={columns.list.width}
				mode={columns.list.mode}
				fallback={
					!arrived ? (
						<div className="flex h-full min-h-0 flex-col px-3">
							<div className="h-[52px] flex-none [-webkit-app-region:drag]" />
							<div className="flex min-h-0 flex-1 flex-col pt-2">
								<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
									<SessionListSkeleton />
								</div>
							</div>
						</div>
					) : undefined
				}
			/>

			{columns.list.mode === "flow" ? (
				<Grip
					{...host.columns.gripLimits("list")}
					width={() => host.columns.store.getState().columns.list.width}
					side="left"
					variant="list"
					label="Resize the chat list"
					readout={(width) => readout("list", width)}
					onResize={(width) => host.columns.setListWidth(width)}
					onReset={() => host.columns.resetListWidth()}
				/>
			) : null}

			<Column
				host={host}
				slot="main"
				min={columns.workbench || undefined}
				onBackground={columns.list.mode === "overlay" ? () => host.columns.closeList() : undefined}
				fallback={
					!arrived ? (
						<div className="flex min-h-0 flex-1 flex-col">
							<div className="h-[52px] flex-none [-webkit-app-region:drag]" />
							<div className="chat-main">
								<TranscriptSkeleton />
							</div>
						</div>
					) : undefined
				}
			/>

			{columns.dock.mode === "flow" ? (
				<Grip
					{...host.columns.gripLimits("dock")}
					width={() => host.columns.store.getState().columns.dock.width}
					side="right"
					variant="dock"
					label="Resize the dock"
					readout={(width) => readout("dock", width)}
					onResize={(width) => host.columns.setDockWidth(width)}
					onReset={() => host.columns.resetDockWidth()}
				/>
			) : null}

			{columns.dock.mode !== "closed" ? <Column host={host} slot="dock" width={columns.dock.width} mode={columns.dock.mode === "overlay" ? "overlay" : "flow"} /> : null}

			<DialogHost host={host} />
		</div>
	);
}

function Column(props: { host: Host; slot: string; width?: number; min?: number; mode?: "flow" | "collapsed" | "overlay"; onBackground?: () => void; fallback?: ReactNode }) {
	const ids = useStore(props.host.layout.store).layout[props.slot] ?? [];
	const floating = props.mode === "overlay";
	const hidden = props.mode === "collapsed";

	return (
		<div
			className={`column ${props.slot}${floating ? " floating" : ""}${hidden ? " collapsed" : ""}`}
			style={{ ...(props.width === undefined ? {} : { width: hidden ? 0 : props.width }), ...(props.min === undefined ? {} : { minWidth: props.min }) }}
			onPointerDown={props.onBackground}
		>
			{ids.length === 0 && props.fallback
				? props.fallback
				: ids.map((id) => {
						const Component = props.host.surfaces.get(id);
						if (!Component) {
							return (
								<Tip key={id} label={`${props.slot}:${id}`}>
									<div className="surface-missing" data-surface={id} />
								</Tip>
							);
						}
						return <Component key={id} host={props.host} />;
					})}
		</div>
	);
}
