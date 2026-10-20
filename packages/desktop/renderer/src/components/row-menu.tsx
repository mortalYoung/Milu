import type { ContributionItem } from "@milu/protocol";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

import { ChevronRightIcon, IconByName } from "./icons.tsx";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent(props: { children: ReactNode }) {
	return (
		<DropdownMenu.Portal>
			<DropdownMenu.Content className="conv-menu" side="right" align="start" sideOffset={4} collisionPadding={8}>
				{props.children}
			</DropdownMenu.Content>
		</DropdownMenu.Portal>
	);
}

export function MenuSeparator() {
	return <DropdownMenu.Separator className="conv-menu-separator" />;
}

export function MenuItems(props: { items: readonly ContributionItem[]; onRun: (item: ContributionItem) => void }) {
	return (
		<>
			{props.items.map((item, index, all) => (
				<MenuEntry key={item.id} item={item} first={index === 0} previous={all[index - 1]} onRun={props.onRun} />
			))}
		</>
	);
}

function MenuEntry(props: { item: ContributionItem; first: boolean; previous?: ContributionItem; onRun: (item: ContributionItem) => void }) {
	const { item } = props;
	const separator = !props.first && item.group !== props.previous?.group ? <MenuSeparator /> : null;

	if (item.items && item.items.length > 0) {
		return (
			<>
				{separator}
				<DropdownMenu.Sub>
					<DropdownMenu.SubTrigger className="conv-menu-item">
						<IconByName name={item.icon} size={13} />
						<span>{item.title}</span>
						<ChevronRightIcon size={13} />
					</DropdownMenu.SubTrigger>
					<DropdownMenu.Portal>
						<DropdownMenu.SubContent className="conv-menu" sideOffset={4} alignOffset={-4} collisionPadding={8}>
							<MenuItems items={item.items} onRun={props.onRun} />
						</DropdownMenu.SubContent>
					</DropdownMenu.Portal>
				</DropdownMenu.Sub>
			</>
		);
	}

	return (
		<>
			{separator}
			<DropdownMenu.Item className={`conv-menu-item${item.danger ? " danger" : ""}`} onSelect={() => props.onRun(item)}>
				<IconByName name={item.icon} size={13} />
				<span>{item.title}</span>
			</DropdownMenu.Item>
		</>
	);
}
