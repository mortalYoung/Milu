import type { WidgetProps } from "@milu/client";

import { useStore } from "./use-store.ts";

import "./widgets.css";

export function ShellWidget(props: WidgetProps) {
	const { host } = props;
	const shellMode = useStore(host.composer.shellMode);

	return (
		<button
			type="button"
			className={`composer-icon-btn${shellMode ? " on" : ""}`}
			aria-label="Shell mode"
			aria-pressed={shellMode}
			title="Shell mode (⇥)"
			onClick={() => host.composer.toggleShell()}
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
				<path d="M12 2v20" />
				<path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
			</svg>
		</button>
	);
}
