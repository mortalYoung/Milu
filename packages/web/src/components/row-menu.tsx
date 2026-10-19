import type { OpenTargets } from "@milu/client";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

import { ChevronRightIcon } from "./icons.tsx";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuSub = DropdownMenu.Sub;
export const MenuSubTrigger = DropdownMenu.SubTrigger;

export function MenuContent(props: { children: ReactNode }) {
	return (
		<DropdownMenu.Portal>
			<DropdownMenu.Content className="conv-menu" side="right" align="start" sideOffset={4} collisionPadding={8}>
				{props.children}
			</DropdownMenu.Content>
		</DropdownMenu.Portal>
	);
}

export function MenuItem(props: { children: ReactNode; onSelect: () => void; danger?: boolean }) {
	return (
		<DropdownMenu.Item className={`conv-menu-item${props.danger ? " danger" : ""}`} onSelect={props.onSelect}>
			{props.children}
		</DropdownMenu.Item>
	);
}

export function MenuSeparator() {
	return <DropdownMenu.Separator className="conv-menu-separator" />;
}

export function MenuSubContent(props: { children: ReactNode }) {
	return (
		<DropdownMenu.Portal>
			<DropdownMenu.SubContent className="conv-menu" sideOffset={4} alignOffset={-4} collisionPadding={8}>
				{props.children}
			</DropdownMenu.SubContent>
		</DropdownMenu.Portal>
	);
}

/** One place a row sends a folder: the entries are whatever this machine actually has. */
export function OpenMenu(props: { label: string; path: string | null; targets: OpenTargets; onOpen: (target: { editorId?: string; via?: "default" | "finder" }) => void }) {
	const { label, path, targets, onOpen } = props;
	if (!path) return null;

	return (
		<MenuSub>
			<MenuSubTrigger className="conv-menu-item">
				<span>{label}</span>
				<ChevronRightIcon size={13} />
			</MenuSubTrigger>
			<MenuSubContent>
				<MenuItem onSelect={() => onOpen({})}>Open with default</MenuItem>
				{targets.finder ? <MenuItem onSelect={() => onOpen({ via: "finder" })}>Open with Finder</MenuItem> : null}
				{targets.editors.map((editor) => (
					<MenuItem key={editor.id} onSelect={() => onOpen({ editorId: editor.id })}>
						Open with {editor.name}
					</MenuItem>
				))}
			</MenuSubContent>
		</MenuSub>
	);
}
