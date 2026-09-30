import type { MouseEvent } from "react";
import { rpc } from "./rpc";
import { isInteractive } from "./utils";

export function zoomOnDoubleClick(event: MouseEvent<HTMLElement>): void {
	if (isInteractive(event.target)) return;
	void rpc.request.window_zoom_toggle({});
}
