import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import { readManifest } from "./manifest.ts";
import type { ExtensionSource, LocatedExtension } from "./source.ts";

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

export function diskSource(dir: string): ExtensionSource {
	return {
		id: "disk",
		fatal: false,
		async find(): Promise<readonly LocatedExtension[]> {
			const workspace = join(dir, "package.json");
			let raw: string;
			try {
				raw = await readFile(workspace, "utf8");
			} catch (error) {
				if (isMissing(error)) return [];
				throw error;
			}

			const { dependencies } = JSON.parse(raw) as { dependencies?: unknown };
			if (dependencies !== undefined && (typeof dependencies !== "object" || dependencies === null || Array.isArray(dependencies))) {
				throw new Error(`"dependencies" is not a mapping of package names`);
			}

			const { resolve } = createRequire(workspace);
			return Promise.all(
				Object.keys(dependencies ?? {}).map(async (name) => {
					const root = join(dir, "node_modules", ...name.split("/"));
					try {
						const manifest = await readManifest(root, name);
						const extension = { id: manifest.id, apiVersion: manifest.apiVersion, widgets: manifest.widgets, contributions: manifest.contributions };
						return { ref: name, root, entry: resolve(name), services: manifest.services, module: Promise.resolve({ default: extension }) };
					} catch (error) {
						return { ref: name, root, module: Promise.reject(error as Error) };
					}
				}),
			);
		},
	};
}
