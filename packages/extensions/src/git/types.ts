export type GitChangeStatus = "M" | "A" | "D" | "R" | "U";

export interface GitChange {
	readonly path: string;
	readonly status: GitChangeStatus;
	readonly staged: boolean;
	readonly untracked?: boolean;
	readonly from?: string;
}

export interface GitChanges {
	readonly repoRoot: string | null;
	readonly changes: readonly GitChange[];
}

export interface GitSides {
	readonly original: string;
	readonly modified: string;
	readonly add: number;
	readonly del: number;
	readonly binary: boolean;
	readonly tooLarge: boolean;
}

export interface GitPatch {
	readonly kind: "diff" | "new";
	readonly diff: string;
	readonly content: string;
}

export interface GitWorktree {
	readonly path: string;
	readonly branch: string | null;
	readonly head: string | null;
}

export interface GitWorktrees {
	readonly repoRoot: string;
	readonly current: string | null;
	readonly worktrees: readonly GitWorktree[];
}
