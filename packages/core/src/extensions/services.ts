import type { ServiceCollection } from "@milu/di";

import type { Extension } from "./types.ts";

export function declareExtensionServices(services: ServiceCollection, extensions: readonly Extension[]): void {
	for (const extension of extensions) {
		for (const service of extension.services ?? []) {
			if (!service.id.name.startsWith(`${extension.id}.`)) {
				throw new Error(`extension "${extension.id}" declares "${service.id.name}" outside its namespace`);
			}
			services.set(service.id, service.create);
		}
	}
}
