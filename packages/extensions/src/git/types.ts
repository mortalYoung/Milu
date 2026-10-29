export type GitChangeStatus = "M" | "A" | "D" | "R" | "U";

export interface GitChange {
	readonly path: string;
	readonly status: GitChangeStatus;
	readonly staged: boolean;
	readonly untracked?: boolean;
	/** For a rename or copy: the name the file had before. */
	readonly from?: string;
}

export interface GitChanges {
	/** Null when the workspace is not inside a repository. */
	readonly repoRoot: string | null;
	readonly changes: readonly GitChange[];
}

export interface GitSides {
	readonly original: string;
	readonly modified: string;
	/** Added and removed lines, straight from git rather than counted out of the two sides. */
	readonly add: number;
	readonly del: number;
	/** A side is not text: there is no line-by-line reading to show. */
	readonly binary: boolean;
	/** A side is larger than the preview ceiling. */
	readonly tooLarge: boolean;
}

export interface GitPatch {
	readonly kind: "diff" | "new";
	readonly diff: string;
	readonly content: string;
}
