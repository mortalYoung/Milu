import { For, Show } from "solid-js";
import type { CommandDescriptor } from "../../shared/rpc";

type Row = { header: string } | { item: CommandDescriptor; index: number };

function groupItems(items: CommandDescriptor[]): Row[] {
	const rows: Row[] = [];
	const commands = items.map((item, index) => ({ item, index })).filter((x) => x.item.category !== "skill");
	const skills = items.map((item, index) => ({ item, index })).filter((x) => x.item.category === "skill");
	if (commands.length > 0) {
		rows.push({ header: "Commands" });
		rows.push(...commands);
	}
	if (skills.length > 0) {
		rows.push({ header: "Skills" });
		rows.push(...skills);
	}
	return rows;
}

export function CommandMenu(props: { items: CommandDescriptor[]; selectedIndex: number; onPick: (index: number) => void; onHover: (index: number) => void }) {
	const rows = () => groupItems(props.items);
	return (
		<div class="command-menu" role="listbox" aria-label="Commands">
			<For each={rows()}>
				{(row) =>
					"header" in row ? (
						<div class="command-menu-header">{row.header}</div>
					) : (
						<button
							type="button"
							class={"command-menu-item" + (row.index === props.selectedIndex ? " selected" : "")}
							role="option"
							aria-selected={row.index === props.selectedIndex}
							onMouseEnter={() => props.onHover(row.index)}
							onClick={() => props.onPick(row.index)}
						>
							<span class="command-menu-name">/{row.item.name}</span>
							<span class="command-menu-desc">{row.item.description}</span>
							{row.item.kind === "leadingInput" && row.item.hint ? <span class="command-menu-hint">{row.item.hint}</span> : null}
							{row.item.kind === "popupSelect" ? <span class="command-menu-hint">…</span> : null}
							{row.item.category === "skill" ? <span class="command-menu-badge">skill</span> : null}
						</button>
					)
				}
			</For>
			<Show when={rows().length === 0}>
				<div class="command-menu-empty">no command found</div>
			</Show>
		</div>
	);
}
