import { For, Show } from "solid-js";
import type { CommandDescriptor } from "../../shared/rpc";

/**
 * CommandMenu — the slash palette above the composer pill. Same paper language
 * as the run-settings panel: letter + hairline + 8px radius, no shadow.
 */
export function CommandMenu(props: { items: CommandDescriptor[]; selectedIndex: number; onPick: (index: number) => void; onHover: (index: number) => void }) {
	return (
		<div class="command-menu" role="listbox" aria-label="Commands">
			<For each={props.items}>
				{(item, i) => (
					<button
						type="button"
						class={"command-menu-item" + (i() === props.selectedIndex ? " selected" : "")}
						role="option"
						aria-selected={i() === props.selectedIndex}
						onMouseEnter={() => props.onHover(i())}
						onClick={() => props.onPick(i())}
					>
						<span class="command-menu-name">/{item.name}</span>
						<span class="command-menu-desc">{item.description}</span>
						{item.kind === "leadingInput" && item.hint ? <span class="command-menu-hint">{item.hint}</span> : null}
						{item.kind === "popupSelect" ? <span class="command-menu-hint">…</span> : null}
					</button>
				)}
			</For>
			<Show when={props.items.length === 0}>
				<div class="command-menu-empty">no command found</div>
			</Show>
		</div>
	);
}
