export const COLUMNS = 8;
export const ROWS = 11;
export const CELL = { width: 192, height: 208 } as const;

export const STATES = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review", "look-000-to-157.5", "look-180-to-337.5"] as const;

export type SpriteState = (typeof STATES)[number];

export const FRAMES: Readonly<Record<SpriteState, number>> = {
	idle: 6,
	"running-right": 8,
	"running-left": 8,
	waving: 4,
	jumping: 5,
	failed: 8,
	waiting: 6,
	running: 6,
	review: 6,
	"look-000-to-157.5": 8,
	"look-180-to-337.5": 8,
};

export const DURATION: Readonly<Record<string, number>> = { idle: 1200, running: 620, waiting: 900, failed: 900 };

export interface PetSheet {
	readonly id: string;
	readonly name: string;
	readonly file: string;
}

export const PETS: Readonly<Record<string, PetSheet>> = {
	milu: { id: "milu", name: "Milu", file: "milu.png" },
};

export const PET_IDS: readonly string[] = Object.keys(PETS);

export interface PetState {
	readonly chosen: string;
	readonly size: number;
	readonly overlay: boolean;
	readonly follow: boolean;
	readonly enabled: boolean;
	readonly open: boolean;
}

export function rowOf(state: SpriteState): number {
	return STATES.indexOf(state);
}

function packageRoot(url: string): string {
	const cut = url.lastIndexOf("/dist/");
	return cut < 0 ? url.slice(0, url.lastIndexOf("/")) : url.slice(0, cut);
}

export function assetOf(file: string): string {
	return `${packageRoot(import.meta.url)}/assets/${file}`;
}

export function sheetOf(value: unknown): PetSheet {
	return PETS[String(value)] ?? PETS[PET_IDS[0] ?? "milu"]!;
}
