import type { Host } from "@milu/client";
import { useEffect, useRef } from "react";

import { DialogHost } from "./components/dialog-host.tsx";
import { Grip } from "./components/grip.tsx";
import { useStore } from "./use-store.ts";

export function Workbench(props: { host: Host }) {
	const { host } = props;

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
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

	const layout = useStore(host.layoutState);
	const columns = useStore(host.columns.state);
	const dockIds = layout.layout["dock"] ?? [];
	const row = useRef<HTMLDivElement>(null);

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
			<Column host={host} slot="sidebar" width={columns.list.width} mode={columns.list.mode} />

			{columns.list.mode === "flow" ? (
				<Grip onDrag={(delta: number) => host.columns.setListWidth(columns.list.width + delta)} onReset={() => host.columns.resetListWidth()} />
			) : null}

			<Column host={host} slot="main" min={columns.workbench || undefined} onBackground={columns.list.mode === "overlay" ? () => host.columns.closeList() : undefined} />

			{columns.dock.mode === "flow" ? (
				<Grip onDrag={(delta: number) => host.columns.setDockWidth(columns.dock.width - delta)} onReset={() => host.columns.resetDockWidth()} />
			) : null}

			{columns.dock.mode !== "closed" ? <Column host={host} slot="dock" width={columns.dock.width} mode={columns.dock.mode === "overlay" ? "overlay" : "flow"} /> : null}

			<DialogHost host={host} />
		</div>
	);
}

function Column(props: { host: Host; slot: string; width?: number; min?: number; mode?: "flow" | "collapsed" | "overlay"; onBackground?: () => void }) {
	const ids = useStore(props.host.layoutState).layout[props.slot] ?? [];
	const floating = props.mode === "overlay";
	const hidden = props.mode === "collapsed";

	return (
		<div
			className={`column ${props.slot}${floating ? " floating" : ""}${hidden ? " collapsed" : ""}`}
			style={{ ...(props.width === undefined ? {} : { width: hidden ? 0 : props.width }), ...(props.min === undefined ? {} : { minWidth: props.min }) }}
			onPointerDown={props.onBackground}
		>
			{ids.map((id) => {
				const Component = props.host.surfaces.get(id);
				if (!Component) return <div key={id} className="surface-missing" data-surface={id} title={`${props.slot}:${id}`} />;
				return <Component key={id} host={props.host} />;
			})}
		</div>
	);
}
