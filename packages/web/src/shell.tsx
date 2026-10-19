import type { Host } from "@milu/client";
import { useEffect } from "react";

import { useStore } from "./use-store.ts";

/** The frame: only the slots the layout asks for, and the keys that move between them. */
export function Shell(props: { host: Host }) {
	const { host } = props;

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey)) return;
			if (event.key === "f") {
				event.preventDefault();
				host.shell.setSearch(true);
				return;
			}
			if (event.key === "b") {
				event.preventDefault();
				host.shell.toggleList();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [host]);

	const layout = useStore(host.layout.layout);

	return (
		<div className="chat-page">
			{Object.keys(layout).map((slot) => (
				<Slot key={slot} host={host} slot={slot} />
			))}
		</div>
	);
}

function Slot(props: { host: Host; slot: string }) {
	const { host, slot } = props;
	useStore(host.layout.layout);
	return (
		<>
			{host.layout.surfaces(slot).map((surface) => (
				<surface.component key={surface.id} host={host} />
			))}
		</>
	);
}
