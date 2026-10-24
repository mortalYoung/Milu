import { join } from "node:path";

import { diskSource, type ExtensionSource } from "@milu/core";
import { BUILTIN } from "@milu/extensions";

export function sources(root: string): readonly ExtensionSource[] {
	return [
		{
			id: "builtin",
			fatal: true,
			find: async () => Object.entries(BUILTIN).map(([ref, load]) => ({ ref, module: load() })),
		},
		diskSource(join(root, "extensions")),
	];
}
