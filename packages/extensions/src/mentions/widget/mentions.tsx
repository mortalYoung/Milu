import type { SessionRow } from "@milu/protocol";

import { DESC, EMPTY, HEADER, HINT, ITEM, MENU } from "../../composer/menu.ts";
import type { ComposerTriggerComponent, ComposerTriggerProps } from "../../host/index.ts";
import { oneLine } from "../../host/index.ts";

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
		<div className={MENU} role="listbox" aria-label="Partners">
			<div className={HEADER}>Partners</div>
			{rows.map((row, index) => (
				<button
					type="button"
					key={row.name}
					className={`${ITEM} ${index === props.selectedIndex ? "bg-hover" : ""}`}
					role="option"
					aria-selected={index === props.selectedIndex}
					onMouseEnter={() => props.onHover(index)}
					onClick={() => props.onPick(index)}
				>
					<span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-surface font-serif text-[12px] font-semibold leading-none text-ink">
						<span className="block translate-y-[0.1em] leading-none">{row.name.charAt(0)}</span>
					</span>
					<span className="shrink-0 text-ink">@{row.name}</span>
					{row.lastMessage ? <span className={DESC}>{oneLine(row.lastMessage)}</span> : null}
					{row.running ? <span className={HINT}>writing…</span> : null}
				</button>
			))}
			{rows.length === 0 ? <div className={EMPTY}>no partner found</div> : null}
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
