import { CELL, type PetState, sheetOf } from "./sheets.ts";

const WINDOW = "pet";
const MAX_EDGE = Math.floor((512 * CELL.width) / CELL.height);

interface MenuItem {
	readonly label?: string;
	readonly type?: "normal" | "checkbox" | "separator";
	readonly checked?: boolean;
	readonly action?: string;
	readonly args?: unknown;
}

interface Point<T> {
	get(): T;
	readonly when: Promise<void>;
	watch(listener: () => void): { dispose(): void };
}

interface ChildContext {
	readonly settings: { declare<T>(section: { readonly key: string; readonly defaults: T }): Point<T> };
	readonly windows: {
		create(descriptor: unknown): Promise<unknown>;
		close(window: string): Promise<void>;
		menu(window: string, items: readonly MenuItem[]): Promise<void>;
	};
	readonly actions: {
		register(action: { id: string; scope?: string; hotkey?: string; run(context: { args?: unknown; session: string | null }): unknown }): { dispose(): void };
	};
	readonly contributions: { provide(key: string, load: (session: string | null) => unknown): { dispose(): void } };
	readonly disposables: { add<T>(value: T): T };
}

export default {
	async activate(context: ChildContext) {
		const enabled = context.settings.declare({ key: "petEnabled", defaults: true });
		const chosen = context.settings.declare({ key: "petId", defaults: "milu" });
		const size = context.settings.declare({ key: "petSize", defaults: 240 });
		const overlay = context.settings.declare({ key: "petOverlay", defaults: false });
		const follow = context.settings.declare({ key: "petFollow", defaults: false });
		const on = (): boolean => enabled.get() !== false;
		let open = false;

		const close = async (): Promise<void> => {
			if (!open) return;
			open = false;
			await context.windows.close(WINDOW);
		};

		const show = async (session: string): Promise<void> => {
			if (!on() || open) return;
			const edge = Math.min(size.get(), MAX_EDGE);
			open = true;
			try {
				await context.windows.create({
					id: WINDOW,
					window: "pet.float",
					width: edge,
					height: Math.round((edge * CELL.height) / CELL.width),
					anchor: "bottom-right",
					clickThrough: false,
					data: { pet: sheetOf(chosen.get()).id, size: edge, session },
				});
			} catch (error) {
				open = false;
				throw error;
			}
		};

		const settle = (session: string): void => {
			if (on()) void show(session).catch((error: unknown) => console.error("[milu] pet window failed to open", error));
			else void close();
		};

		const reload = (): void => {
			if (!open) return;
			void close().then(() => settle(""));
		};

		const menu = (): readonly MenuItem[] => [
			{
				label: "Follow Cursor",
				type: "checkbox" as const,
				checked: follow.get() === true,
				action: "settings.update",
				args: { patch: { petFollow: follow.get() !== true } },
			},
			{ label: "Disabled", type: "checkbox" as const, checked: !on(), action: "settings.update", args: { patch: { petEnabled: false } } },
			{ type: "separator" as const },
			{ label: "Settings…", action: "settings.open" },
		];

		context.disposables.add({ dispose: () => void close() });
		context.disposables.add(enabled.watch(() => settle("")));
		context.disposables.add(chosen.watch(reload));
		context.disposables.add(size.watch(reload));

		context.contributions.provide(
			"state",
			() =>
				({
					chosen: sheetOf(chosen.get()).id,
					size: size.get(),
					overlay: overlay.get() === true,
					follow: follow.get() === true,
					enabled: on(),
					open,
				}) satisfies PetState,
		);

		context.actions.register({
			id: "pet.menu",
			run: async () => {
				if (!open) return;
				await context.windows.menu(WINDOW, menu());
			},
		});

		await Promise.all([enabled.when, chosen.when, size.when, overlay.when, follow.when]);
		settle("");
	},
};
