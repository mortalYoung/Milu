export type ExplorerSource = "workspace" | "storage";

export interface ExplorerEntry {
	readonly name: string;
	readonly path: string;
	readonly kind: "file" | "directory" | "symlink";
	readonly size: number;
	readonly ignored?: boolean;
}

export interface ExplorerListing {
	readonly root: string;
	readonly path: string;
	readonly entries: readonly ExplorerEntry[];
}

export interface ExplorerFile {
	readonly path: string;
	readonly text: string;
	readonly size: number;
	readonly truncated?: boolean;
	readonly binary?: boolean;
}

export interface OpenFile {
	readonly path: string;
	readonly name: string;
}
