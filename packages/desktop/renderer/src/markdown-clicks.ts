import type { Host } from "@milu/window";

import { copyPath } from "./clipboard.ts";

const COPIED_MS = 1200;
const timers = new WeakMap<Element, number>();

function copied(button: HTMLElement): void {
	button.classList.add("copied");
	window.clearTimeout(timers.get(button));
	timers.set(
		button,
		window.setTimeout(() => button.classList.remove("copied"), COPIED_MS),
	);
}

function argsOf(raw: string | undefined): unknown {
	if (raw === undefined) return undefined;
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return undefined;
	}
}

export function installMarkdownClicks(host: Host): void {
	document.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;

		const copy = target.closest(".md-copy");
		if (copy instanceof HTMLElement) {
			const code = copy.parentElement?.querySelector("pre")?.textContent;
			if (code != null) void copyPath(code);
			copied(copy);
			return;
		}

		const button = target.closest("[data-milu-action]");
		if (!(button instanceof HTMLElement)) return;
		const action = button.dataset["miluAction"];
		if (!action) return;
		event.preventDefault();
		void host.actions.invoke(action, button.dataset["miluSession"], argsOf(button.dataset["miluArgs"]));
	});
}
