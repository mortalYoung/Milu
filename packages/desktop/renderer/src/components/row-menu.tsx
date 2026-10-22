import type { ContributionItem } from "@milu/protocol";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

import { ChevronRightIcon, IconByName } from "./icons.tsx";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent(props: { children: ReactNode }) {
	return (
		<DropdownMenu.Portal>
			<DropdownMenu.Content
				className="conv-menu fixed z-50 w-max min-w-[176px] max-w-[min(320px,calc(100vw-16px))] rounded-lg border border-line-strong bg-surface p-1 shadow-[0_8px_24px_color-mix(in_srgb,var(--ink)_12%,transparent)] outline-none"
				side="right"
				align="start"
				sideOffset={4}
				collisionPadding={8}
			>
				{props.children}
			</DropdownMenu.Content>
		</DropdownMenu.Portal>
	);
}

export function MenuSeparator() {
	return <DropdownMenu.Separator className="my-1 h-px bg-line" />;
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
					<DropdownMenu.SubTrigger className="flex w-full cursor-pointer items-center gap-1.5 rounded bg-transparent px-2 py-1 text-left font-sans text-[14px] whitespace-nowrap text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] data-[highlighted]:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] data-[highlighted]:outline-none data-[state=open]:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)]">
						<IconByName name={item.icon} size={13} className="shrink-0 text-muted" />
						<span>{item.title}</span>
						<ChevronRightIcon size={13} className="ml-auto shrink-0 text-muted" />
					</DropdownMenu.SubTrigger>
					<DropdownMenu.Portal>
						<DropdownMenu.SubContent
							className="conv-menu fixed z-50 w-max min-w-[176px] max-w-[min(320px,calc(100vw-16px))] rounded-lg border border-line-strong bg-surface p-1 shadow-[0_8px_24px_color-mix(in_srgb,var(--ink)_12%,transparent)] outline-none"
							sideOffset={4}
							alignOffset={-4}
							collisionPadding={8}
						>
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
			<DropdownMenu.Item
				className={`flex w-full cursor-pointer items-center gap-1.5 rounded bg-transparent px-2 py-1 text-left font-sans text-[14px] whitespace-nowrap transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] data-[highlighted]:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] data-[highlighted]:outline-none data-[state=open]:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] ${
					item.danger ? "text-signal" : "text-ink"
				}`}
				onSelect={() => props.onRun(item)}
			>
				<IconByName name={item.icon} size={13} className="shrink-0 text-muted" />
				<span>{item.title}</span>
			</DropdownMenu.Item>
		</>
	);
}
