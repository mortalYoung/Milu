import type { CommandDescriptor } from "../../shared/rpc";
import { useRowInView } from "../lib/menu-scroll";

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

const ROW_ID = "composer-command-option";

export function CommandMenu(props: { items: CommandDescriptor[]; selectedIndex: number; onPick: (index: number) => void; onHover: (index: number) => void }) {
	const rows = groupItems(props.items);
	useRowInView(ROW_ID, props.selectedIndex);
	return (
		<div className="command-menu" role="listbox" aria-label="Commands">
			{rows.map((row) =>
				"header" in row ? (
					<div className="command-menu-header" key={`h:${row.header}`}>
						{row.header}
					</div>
				) : (
					<button
						type="button"
						key={`i:${row.item.name}`}
						id={`${ROW_ID}-${row.index}`}
						className={"command-menu-item" + (row.index === props.selectedIndex ? " selected" : "")}
						role="option"
						aria-selected={row.index === props.selectedIndex}
						onMouseEnter={() => props.onHover(row.index)}
						onClick={() => props.onPick(row.index)}
					>
						<span className="command-menu-name">/{row.item.name}</span>
						<span className="command-menu-desc">{row.item.description}</span>
						{row.item.hint ? <span className="command-menu-hint">{row.item.hint}</span> : null}
						{row.item.kind === "popupSelect" ? <span className="command-menu-hint">…</span> : null}
						{row.item.category === "skill" ? <span className="command-menu-badge">skill</span> : null}
					</button>
				),
			)}
			{rows.length === 0 && <div className="command-menu-empty">no command found</div>}
		</div>
	);
}
