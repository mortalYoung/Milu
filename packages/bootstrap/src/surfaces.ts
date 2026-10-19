import type { SurfaceDeclaration } from "@milu/protocol";

export const BUILT_IN_SURFACES: readonly SurfaceDeclaration[] = [
	{ id: "milu.session-list", slot: "sidebar", order: 10 },
	{ id: "milu.transcript", slot: "main", order: 10 },
];
