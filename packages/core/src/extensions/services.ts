import type { Container } from "@milu/di";

import type { Extension } from "./types.ts";

export function declareExtensionServices(container: Container, extensions: readonly Extension[]): void {
	for (const extension of extensions) {
		for (const service of extension.services ?? []) {
			if (!service.id.name.startsWith(`${extension.id}.`)) {
				throw new Error(`extension "${extension.id}" declares "${service.id.name}" outside its namespace`);
			}
			container.register(service.id, service.create);
		}
	}
}
