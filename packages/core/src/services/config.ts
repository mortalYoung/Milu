import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createServiceId, type Service } from "@milu/di";
import { parse, stringify } from "yaml";

export interface ConfigDeps {
	root: string;
	workspace: string;
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function asKeyMap(value: unknown): Record<string, string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected a mapping of provider id to api key");
	}
	const keys: Record<string, string> = {};
	for (const [provider, key] of Object.entries(value)) {
		if (typeof key !== "string") throw new Error(`"${provider}" is not a string`);
		keys[provider] = key;
	}
	return keys;
}

export class ConfigService implements Service {
	readonly root: string;
	readonly workspace: string;

	private readonly _credentialsFile: string;
	private _keys: Record<string, string> = {};
	private _loaded = false;

	constructor(deps: ConfigDeps) {
		this.root = deps.root;
		this.workspace = deps.workspace;
		this._credentialsFile = join(deps.root, ".credentials.yaml");
	}

	async initialize(): Promise<void> {
		let raw: string | null = null;
		try {
			raw = await readFile(this._credentialsFile, "utf8");
		} catch (error) {
			if (!isMissing(error)) throw new Error(`cannot read ${this._credentialsFile}: ${reason(error)}`);
		}
		try {
			const parsed: unknown = raw === null ? null : parse(raw);
			this._keys = parsed === null || parsed === undefined ? {} : asKeyMap(parsed);
		} catch (error) {
			throw new Error(`cannot parse ${this._credentialsFile}: ${reason(error)}`);
		}
		this._loaded = true;
	}

	// ——— the keys ———

	apiKey(provider: string): string | undefined {
		this._assertLoaded();
		return this._keys[provider];
	}

	providers(): string[] {
		this._assertLoaded();
		return Object.keys(this._keys);
	}

	async setApiKey(provider: string, key: string): Promise<void> {
		this._assertLoaded();
		const next = { ...this._keys, [provider]: key };
		await this._write(next);
		this._keys = next;
	}

	async deleteApiKey(provider: string): Promise<void> {
		this._assertLoaded();
		if (!(provider in this._keys)) return;
		const next = { ...this._keys };
		delete next[provider];
		await this._write(next);
		this._keys = next;
	}

	dispose(): void {}

	private _assertLoaded(): void {
		if (!this._loaded) throw new Error(`${this._credentialsFile} has not been loaded — call initialize()`);
	}

	// ——— the file ———

	private async _write(keys: Record<string, string>): Promise<void> {
		await mkdir(this.root, { recursive: true });
		const tmp = `${this._credentialsFile}.tmp`;
		await writeFile(tmp, stringify(keys), { encoding: "utf8", mode: 0o600 });
		await chmod(tmp, 0o600);
		await rename(tmp, this._credentialsFile);
	}
}

export const IConfigService = createServiceId<ConfigService>("ConfigService");
