import * as api from "@milu/window/api";
import * as react from "react";

export interface WindowBridge {
	readonly react: typeof react;
	readonly api: typeof api;
}

export function installWindowBridge(): void {
	(globalThis as { miluHost?: WindowBridge }).miluHost = { react, api };
}
