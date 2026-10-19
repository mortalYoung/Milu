import type { Host } from "@milu/client";
import { useEffect } from "react";

import { useStore } from "./use-store.ts";

/** The working surface: the slots the core asked for, in the order it asked for them, and nothing else. */
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
				host.workbench.toggleList();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [host]);

	const layout = useStore(host.layoutState);

	return (
		<div className="chat-page">
			{Object.entries(layout.layout).flatMap(([slot, ids]) =>
				ids.map((id) => {
					const Component = host.surfaces.get(id);
					if (!Component) return <div key={`${slot}:${id}`} className="surface-missing" data-surface={id} title={`${slot}:${id}`} />;
					return <Component key={`${slot}:${id}`} host={host} />;
				}),
			)}
		</div>
	);
}
