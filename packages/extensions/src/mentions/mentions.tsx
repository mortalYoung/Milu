import type { SessionRow } from "@milu/protocol";

import type { ComposerTriggerComponent, ComposerTriggerProps } from "../host/index.ts";
import { oneLine } from "../host/index.ts";

import "../composer/menu.css";
import "./mentions.css";

function filterPartners(rows: readonly SessionRow[], query: string): readonly SessionRow[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...rows];
	return rows
		.map((row, index) => {
			const name = row.name.toLowerCase();
			return { row, index, rank: name.startsWith(needle) ? 0 : name.includes(needle) ? 1 : -1 };
		})
		.filter((hit) => hit.rank >= 0)
		.sort((left, right) => left.rank - right.rank || left.index - right.index)
		.map((hit) => hit.row);
}

function PartnerMenu(props: ComposerTriggerProps) {
	const rows = props.items as readonly SessionRow[];
	return (
		<div className="command-menu" role="listbox" aria-label="Partners">
			<div className="command-menu-header">Partners</div>
			{rows.map((row, index) => (
				<button
					type="button"
					key={row.name}
					className={"command-menu-item" + (index === props.selectedIndex ? " selected" : "")}
					role="option"
					aria-selected={index === props.selectedIndex}
					onMouseEnter={() => props.onHover(index)}
					onClick={() => props.onPick(index)}
				>
					<span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface font-serif text-[14px] font-semibold leading-none text-ink">
						<span className="block translate-y-[0.1em] leading-none">{row.name.charAt(0)}</span>
					</span>
					<span className="command-menu-name mention-name">@{row.name}</span>
					{row.lastMessage ? <span className="command-menu-desc">{oneLine(row.lastMessage)}</span> : null}
					{row.running ? <span className="command-menu-hint">writing…</span> : null}
				</button>
			))}
			{rows.length === 0 ? <div className="command-menu-empty">no partner found</div> : null}
		</div>
	);
}

export const partnersTrigger: ComposerTriggerComponent = {
	id: "partners",
	trigger: "@",
	order: 10,
	component: PartnerMenu,
	items: (host, query) => filterPartners(host.sessions.store.getState().rows, query),
	insert: (item) => `@${(item as SessionRow).name} `,
};
