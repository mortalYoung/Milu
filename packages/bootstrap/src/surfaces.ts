import type { SurfaceDeclaration } from "@milu/protocol";

/** What this app puts on the page. Extensions add theirs at runtime; the ids are the contract. */
export const BUILT_IN_SURFACES: readonly SurfaceDeclaration[] = [
	{ id: "milu.session-list", slot: "sidebar", order: 10 },
	{ id: "milu.transcript", slot: "main", order: 10 },
];
