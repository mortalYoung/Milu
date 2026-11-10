import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Credential } from "@earendil-works/pi-ai";
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

function asCredential(provider: string, value: unknown): Credential {
	if (typeof value === "string") return { type: "api_key", key: value };
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`"${provider}" is not a credential`);
	const entry = value as Record<string, unknown>;
	if (entry["type"] === "oauth") {
		if (typeof entry["refresh"] !== "string" || typeof entry["access"] !== "string" || typeof entry["expires"] !== "number") {
			throw new Error(`"${provider}" is not an oauth credential`);
		}
		return { ...entry, type: "oauth", refresh: entry["refresh"], access: entry["access"], expires: entry["expires"] };
	}
	if (entry["type"] === "api_key") {
		if (entry["key"] !== undefined && typeof entry["key"] !== "string") throw new Error(`"${provider}" has a non-string key`);
		return entry as Credential;
	}
	throw new Error(`"${provider}" has no credential type`);
}

function asCredentialMap(value: unknown): Record<string, Credential> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected a mapping of provider id to credential");
	}
	const credentials: Record<string, Credential> = {};
	for (const [provider, entry] of Object.entries(value)) credentials[provider] = asCredential(provider, entry);
	return credentials;
}

function serializable(credential: Credential): unknown {
	if (credential.type === "api_key" && credential.env === undefined) return credential.key ?? "";
	return credential;
}

export class ConfigService implements Service {
	readonly root: string;
	readonly workspace: string;

	private readonly _credentialsFile: string;
	private _credentials: Record<string, Credential> = {};
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
			this._credentials = parsed === null || parsed === undefined ? {} : asCredentialMap(parsed);
		} catch (error) {
			throw new Error(`cannot parse ${this._credentialsFile}: ${reason(error)}`);
		}
		this._loaded = true;
	}

	// ——— the credentials ———

	credential(provider: string): Credential | undefined {
		this._assertLoaded();
		return this._credentials[provider];
	}

	apiKey(provider: string): string | undefined {
		const credential = this.credential(provider);
		return credential?.type === "api_key" ? credential.key : undefined;
	}

	providers(): string[] {
		this._assertLoaded();
		return Object.keys(this._credentials);
	}

	async setCredential(provider: string, credential: Credential): Promise<void> {
		this._assertLoaded();
		await this._commit({ ...this._credentials, [provider]: credential });
	}

	async setApiKey(provider: string, key: string): Promise<void> {
		await this.setCredential(provider, { type: "api_key", key });
	}

	async deleteCredential(provider: string): Promise<void> {
		this._assertLoaded();
		if (!(provider in this._credentials)) return;
		const next = { ...this._credentials };
		delete next[provider];
		await this._commit(next);
	}

	async deleteApiKey(provider: string): Promise<void> {
		await this.deleteCredential(provider);
	}

	dispose(): void {}

	private _assertLoaded(): void {
		if (!this._loaded) throw new Error(`${this._credentialsFile} has not been loaded — call initialize()`);
	}

	// ——— the file ———

	private async _commit(credentials: Record<string, Credential>): Promise<void> {
		await mkdir(this.root, { recursive: true });
		const entries: Record<string, unknown> = {};
		for (const [provider, credential] of Object.entries(credentials)) entries[provider] = serializable(credential);
		const tmp = `${this._credentialsFile}.tmp`;
		await writeFile(tmp, stringify(entries), { encoding: "utf8", mode: 0o600 });
		await chmod(tmp, 0o600);
		await rename(tmp, this._credentialsFile);
		this._credentials = credentials;
	}
}

export const IConfigService = createServiceId<ConfigService>("ConfigService");
