import { createServiceId } from "@milu/di";

export type WindowAnchor = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "center";

export interface WindowDeclaration {
	readonly id: string;
	readonly document: string;
	readonly module: string;
}

export interface WindowDescriptor {
	readonly id: string;
	readonly window: string;
	readonly width: number;
	readonly height: number;
	readonly anchor?: WindowAnchor;
	readonly clickThrough?: boolean;
	readonly movable?: boolean;
	readonly data?: unknown;
}

export interface WindowMenuItem {
	readonly label?: string;
	readonly type?: "normal" | "checkbox" | "separator";
	readonly checked?: boolean;
	readonly action?: string;
	readonly args?: unknown;
}

export interface WindowPlacement {
	readonly id: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface WindowHost {
	create(owner: string, descriptor: WindowDescriptor): Promise<WindowPlacement>;
	close(owner: string, id: string): Promise<void>;
	find(owner: string, id: string): string | undefined;
	list(owner: string): readonly WindowPlacement[];
	setClickThrough(owner: string, id: string, ignore: boolean): Promise<void>;
	move(owner: string, id: string, x: number, y: number): Promise<void>;
	menu(owner: string, id: string, items: readonly WindowMenuItem[]): Promise<void>;
}

export interface ScopedWindows {
	create(descriptor: WindowDescriptor): Promise<WindowPlacement>;
	close(id: string): Promise<void>;
	find(id: string): string | undefined;
	list(): readonly WindowPlacement[];
	setClickThrough(id: string, ignore: boolean): Promise<void>;
	move(id: string, x: number, y: number): Promise<void>;
	menu(id: string, items: readonly WindowMenuItem[]): Promise<void>;
}

export type HostedWindows = Pick<ScopedWindows, "create" | "close" | "setClickThrough" | "menu">;

export function scopedWindows(host: WindowHost, owner: string): ScopedWindows {
	return {
		create: (descriptor) => host.create(owner, descriptor),
		close: (id) => host.close(owner, id),
		find: (id) => host.find(owner, id),
		list: () => host.list(owner),
		setClickThrough: (id, ignore) => host.setClickThrough(owner, id, ignore),
		move: (id, x, y) => host.move(owner, id, x, y),
		menu: (id, items) => host.menu(owner, id, items),
	};
}

export const IWindowHost = createServiceId<WindowHost>("WindowHost");
