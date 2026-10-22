import { BADGE, DESC, EMPTY, HEADER, HINT, ITEM, MENU, NAME } from "../../composer/menu.ts";
import type { ComposerCommand, ComposerTriggerComponent, ComposerTriggerProps } from "../../host/index.ts";

type Row = { readonly header: string } | { readonly item: ComposerCommand; readonly index: number };

function filterCommands(commands: readonly ComposerCommand[], query: string): readonly ComposerCommand[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return commands;
	const rank = (command: ComposerCommand): number => {
		const name = command.name.toLowerCase();
		if (name.startsWith(needle)) return 0;
		if (name.includes(needle)) return 1;
		return command.description
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.some((word) => word.startsWith(needle))
			? 2
			: -1;
	};
	return commands
		.map((command) => ({ command, rank: rank(command) }))
		.filter((hit) => hit.rank >= 0)
		.sort((left, right) => left.rank - right.rank || left.command.name.localeCompare(right.command.name))
		.map((hit) => hit.command);
}

function groupItems(items: readonly ComposerCommand[]): readonly Row[] {
	const rows: Row[] = [];
	const commands = items.map((item, index) => ({ item, index })).filter((entry) => entry.item.category !== "skill");
	const skills = items.map((item, index) => ({ item, index })).filter((entry) => entry.item.category === "skill");
	if (commands.length > 0) rows.push({ header: "Commands" }, ...commands);
	if (skills.length > 0) rows.push({ header: "Skills" }, ...skills);
	return rows;
}

function CommandMenu(props: ComposerTriggerProps) {
	const rows = groupItems(props.items as readonly ComposerCommand[]);
	return (
		<div className={MENU} role="listbox" aria-label="Commands">
			{rows.map((row) =>
				"header" in row ? (
					<div className={HEADER} key={`h:${row.header}`}>
						{row.header}
					</div>
				) : (
					<button
						type="button"
						key={`i:${row.item.id}`}
						className={`${ITEM} ${row.index === props.selectedIndex ? "bg-hover" : ""}`}
						role="option"
						aria-selected={row.index === props.selectedIndex}
						onMouseEnter={() => props.onHover(row.index)}
						onClick={() => props.onPick(row.index)}
					>
						<span className={NAME}>/{row.item.name}</span>
						<span className={DESC}>{row.item.description}</span>
						{row.item.hint ? <span className={HINT}>{row.item.hint}</span> : null}
						{row.item.category === "skill" ? <span className={BADGE}>skill</span> : null}
					</button>
				),
			)}
			{rows.length === 0 ? <div className={EMPTY}>no command found</div> : null}
		</div>
	);
}

export const commandsTrigger: ComposerTriggerComponent = {
	id: "commands",
	trigger: "/",
	order: 10,
	leading: true,
	component: CommandMenu,
	items: (host, query) => filterCommands(host.commands.all(), query),
	insert: (item) => `/${(item as ComposerCommand).name} `,
	pick: (host, item, session) => {
		const command = item as ComposerCommand;
		if (command.kind === "leadingInput") return false;
		void host.actions
			.invoke(command.action, session)
			.then(() => host.transcript.reload(session))
			.then(() => host.sessions.refresh())
			.catch((error: unknown) => host.transcript.fail(session, error instanceof Error ? error.message : String(error)));
		return true;
	},
};
