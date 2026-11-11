import { createFrontEnd } from "@milu/bootstrap/frontend";
import { ExtensionSurface } from "@milu/window";
import type { Transport } from "@milu/window";
import { type ComponentType, createElement } from "react";
import { createRoot } from "react-dom/client";

import { installWindowBridge } from "./bridge.ts";
import { IpcTransport } from "./transport.ts";

function draggable(transport: Transport): void {
	let last: { x: number; y: number } | null = null;
	let dx = 0;
	let dy = 0;
	let frame = 0;
	const flush = (): void => {
		frame = 0;
		const stepX = Math.round(dx);
		const stepY = Math.round(dy);
		dx -= stepX;
		dy -= stepY;
		if (stepX === 0 && stepY === 0) return;
		void transport.request("moveWindow", { dx: stepX, dy: stepY }).catch(() => undefined);
	};

	window.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		last = { x: event.screenX, y: event.screenY };
	});
	window.addEventListener("pointermove", (event) => {
		if (last === null) return;
		dx += event.screenX - last.x;
		dy += event.screenY - last.y;
		last = { x: event.screenX, y: event.screenY };
		if (frame === 0) frame = requestAnimationFrame(flush);
	});
	for (const type of ["pointerup", "pointercancel"] as const) window.addEventListener(type, () => (last = null));
}

async function main(): Promise<void> {
	installWindowBridge();
	const params = new URLSearchParams(window.location.search);
	const extension = params.get("extension") ?? "";
	const id = params.get("id") ?? "";
	const moduleUrl = params.get("module") ?? "";
	if (extension === "" || id === "" || moduleUrl === "") throw new Error("the window boot needs ?extension, ?id and ?module");

	const raw = params.get("data");
	let data: unknown = null;
	if (raw !== null) {
		try {
			data = JSON.parse(raw) as unknown;
		} catch {
			throw new Error("?data is not valid JSON");
		}
	}

	const transport = new IpcTransport();
	const front = await createFrontEnd({ transport, platform: "desktop", passive: true });
	draggable(transport);
	const loaded = (await import(/* @vite-ignore */ moduleUrl)) as { default?: unknown };
	if (typeof loaded.default !== "function") throw new Error(`${moduleUrl} has no default component`);

	const root = document.getElementById("root");
	if (root === null) throw new Error("the window document has no #root");
	createRoot(root).render(
		createElement(ExtensionSurface, {
			host: front.host,
			extension,
			id,
			data,
			component: loaded.default as ComponentType<{ readonly id: string; readonly data: unknown }>,
		}),
	);
	front.start();
}

void main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error("[milu] window failed", error);
	document.body.textContent = message;
});
