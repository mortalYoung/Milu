import { useRowInView } from "../lib/menu-scroll";
import type { PartnerItem } from "../lib/session";
import { Avatar } from "./ui/avatar";

/** The `@` picker: the same panel the commands use, one row per partner, avatar included so the row
 *  reads as a correspondent rather than a command. */
const ROW_ID = "composer-partner-option";

export function PartnerMenu(props: { items: PartnerItem[]; selectedIndex: number; onPick: (index: number) => void; onHover: (index: number) => void }) {
	useRowInView(ROW_ID, props.selectedIndex);
	return (
		<div className="command-menu" role="listbox" aria-label="Partners">
			<div className="command-menu-header">Partners</div>
			{props.items.map((partner, index) => (
				<button
					type="button"
					key={partner.name}
					id={`${ROW_ID}-${index}`}
					className={"command-menu-item" + (index === props.selectedIndex ? " selected" : "")}
					role="option"
					aria-selected={index === props.selectedIndex}
					onMouseEnter={() => props.onHover(index)}
					onClick={() => props.onPick(index)}
				>
					<Avatar name={partner.name} size="sm" />
					<span className="command-menu-name mention-name">@{partner.name}</span>
					{partner.lastMessage ? <span className="command-menu-desc">{partner.lastMessage}</span> : null}
					{partner.writing ? <span className="command-menu-hint">writing…</span> : null}
				</button>
			))}
			{props.items.length === 0 && <div className="command-menu-empty">no partner found</div>}
		</div>
	);
}
