import type { SlotProps } from "@milu/window/api";
import { useEffect } from "react";

import { IExplorerTreeService } from "../../explorer/service/tree.ts";

export function MentionsMount(props: SlotProps) {
	const { host } = props;
	useEffect(() => {
		const onClick = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const chip = target.closest(".md-file-mention");
			const path = chip?.getAttribute("data-path");
			if (path === null || path === undefined || path === "") return;
			event.preventDefault();
			host.dock.select("explorer");
			const tree = host.get(IExplorerTreeService);
			tree.openFile(path, path.slice(path.lastIndexOf("/") + 1));
			const line = Number(chip?.getAttribute("data-line"));
			if (Number.isFinite(line) && line >= 1) tree.revealLine(path, line);
			const cut = path.lastIndexOf("/");
			if (cut > 0) void tree.focusDir(path.slice(0, cut));
		};
		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, [host]);
	return null;
}
