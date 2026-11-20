import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { createServiceId, type Service } from "@milu/di";

import { collectPool, DEFAULT_IMAGE_LIMITS, ImageStore, type ImageLimits } from "../attachments/store.ts";
import { ISettingsService } from "./settings.ts";
import type { SettingsService } from "./settings.ts";

function positive(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 1 ? value : fallback;
}

/** Owns image limits, one content-addressed store per session, and the cross-session digest hints. */
export class AttachmentsService implements Service {
	private readonly _stores = new Map<string, ImageStore>();
	private readonly _owners = new Map<string, Map<string, string>>();
	private readonly _scans = new Map<string, Promise<void>>();
	private readonly _scanned = new Set<string>();

	constructor(@ISettingsService private readonly _settingsService: SettingsService) {}

	get limits(): ImageLimits {
		const images = this._settingsService.get().images;
		return {
			maxBytes: Math.floor(positive(images?.maxBytesMb, DEFAULT_IMAGE_LIMITS.maxBytes / (1024 * 1024)) * 1024 * 1024),
			maxPixels: Math.floor(positive(images?.maxMegapixels, DEFAULT_IMAGE_LIMITS.maxPixels / 1_000_000) * 1_000_000),
			maxPerMessage: Math.floor(positive(images?.maxPerMessage, DEFAULT_IMAGE_LIMITS.maxPerMessage)),
		};
	}

	store(partnerRoot: string, sessionRoot: string): ImageStore {
		const key = `${partnerRoot}\u0000${sessionRoot}`;
		const existing = this._stores.get(key);
		if (existing !== undefined) return existing;
		const owners = this._ownersOf(partnerRoot);
		const store = new ImageStore({
			partnerRoot,
			sessionRoot,
			limits: () => this.limits,
			ownerOf: (sha256) => {
				const owner = owners.get(sha256);
				return owner === sessionRoot ? undefined : owner;
			},
			remember: (sha256) => {
				if (!owners.has(sha256)) owners.set(sha256, sessionRoot);
			},
			prepare: () => this.ready(partnerRoot),
		});
		this._stores.set(key, store);
		return store;
	}

	/** Scan every session once per partner root so repeated uploads can be linked instead of copied. */
	async ready(partnerRoot: string): Promise<void> {
		if (this._scanned.has(partnerRoot)) return;
		const existing = this._scans.get(partnerRoot);
		if (existing !== undefined) return existing;
		const scan = this._scan(partnerRoot)
			.then(() => {
				this._scanned.add(partnerRoot);
			})
			.catch(() => undefined)
			.finally(() => {
				this._scans.delete(partnerRoot);
			});
		this._scans.set(partnerRoot, scan);
		return scan;
	}

	async collect(partnerRoot: string): Promise<number> {
		return collectPool(partnerRoot);
	}

	dispose(): void {
		this._stores.clear();
		this._owners.clear();
		this._scans.clear();
		this._scanned.clear();
	}

	private _ownersOf(partnerRoot: string): Map<string, string> {
		const existing = this._owners.get(partnerRoot);
		if (existing !== undefined) return existing;
		const owners = new Map<string, string>();
		this._owners.set(partnerRoot, owners);
		return owners;
	}

	private async _scan(partnerRoot: string): Promise<void> {
		const owners = this._ownersOf(partnerRoot);
		const entries = await readdir(partnerRoot, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
			const sessionRoot = join(partnerRoot, entry.name);
			const names = await readdir(join(sessionRoot, ".attachments", "objects")).catch(() => undefined);
			if (names === undefined) continue;
			for (const name of names) {
				if (name.startsWith(".") || owners.has(name)) continue;
				owners.set(name, sessionRoot);
			}
		}
	}
}

export const IAttachmentsService = createServiceId<AttachmentsService>("AttachmentsService");
