import type { WidgetProps } from "@milu/window/api";
import { Tip } from "@milu/window/api/tooltip";
import { DollarSign } from "lucide-react";
import { useStore } from "zustand";

export function ShellWidget(props: WidgetProps) {
	const { host } = props;
	const shellMode = useStore(host.composer.store, (state) => state.shellMode);

	return (
		<Tip label="Shell mode (⇥)">
			<button type="button" className={`composer-icon-btn${shellMode ? " on" : ""}`} aria-label="Shell mode" aria-pressed={shellMode} onClick={() => host.composer.toggleShell()}>
				<DollarSign size={15} />
			</button>
		</Tip>
	);
}

export default ShellWidget;
