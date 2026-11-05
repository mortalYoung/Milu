import { type ConfigService, type Extension, ICapabilityService, ISessionService, type ModelsService, type Session, type SessionService } from "@milu/core";

const BALANCE_ENDPOINT = "https://api.deepseek.com/user/balance";
const TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 8000;

export interface BalanceInfo {
	readonly currency: string;
	readonly total: number;
	readonly granted: number;
	readonly toppedUp: number;
}

export interface BalanceSnapshot {
	readonly provider: string;
	readonly available: boolean;
	readonly infos: readonly BalanceInfo[];
	readonly at: number;
}

function amount(value: unknown): number | null {
	const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
	return Number.isFinite(parsed) ? parsed : null;
}

function infoOf(value: unknown): BalanceInfo | null {
	if (typeof value !== "object" || value === null) return null;
	const row = value as Record<string, unknown>;
	const currency = typeof row["currency"] === "string" ? row["currency"] : "";
	const total = amount(row["total_balance"]);
	const granted = amount(row["granted_balance"]);
	const toppedUp = amount(row["topped_up_balance"]);
	if (currency === "" || total === null || granted === null || toppedUp === null) return null;
	return { currency, total, granted, toppedUp };
}

async function fetchBalance(key: string): Promise<{ available: boolean; infos: readonly BalanceInfo[] }> {
	const response = await fetch(BALANCE_ENDPOINT, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!response.ok) throw new Error(`DeepSeek balance ${response.status} ${response.statusText}`.trim());
	const body = (await response.json()) as { is_available?: unknown; balance_infos?: unknown };
	const infos = Array.isArray(body.balance_infos) ? body.balance_infos.map(infoOf).filter((each): each is BalanceInfo => each !== null) : [];
	return { available: body.is_available !== false, infos };
}

export class ProviderAccounts {
	private readonly _snapshots = new Map<string, BalanceSnapshot>();
	private readonly _inflight = new Map<string, Promise<BalanceSnapshot>>();

	constructor(
		private readonly _config: ConfigService,
		private readonly _models: ModelsService,
		private readonly _sessions: SessionService,
	) {}

	async balance(name: string | null): Promise<BalanceSnapshot | null> {
		const provider = await this._providerOf(name);
		if (provider !== "deepseek") return null;
		const key = this._config.apiKey(provider);
		if (key === undefined || key === "") return null;
		const cached = this._snapshots.get(provider);
		if (cached !== undefined && Date.now() - cached.at < TTL_MS) return cached;
		let inflight = this._inflight.get(provider);
		if (inflight === undefined) {
			inflight = fetchBalance(key)
				.then((value) => ({ provider, ...value, at: Date.now() }))
				.finally(() => this._inflight.delete(provider));
			this._inflight.set(provider, inflight);
		}
		try {
			const snapshot = await inflight;
			this._snapshots.set(provider, snapshot);
			return snapshot;
		} catch {
			return this._snapshots.get(provider) ?? null;
		}
	}

	dispose(): void {
		this._snapshots.clear();
		this._inflight.clear();
	}

	private async _providerOf(name: string | null): Promise<string | null> {
		if (name === null || name === "") return null;
		let session: Session;
		try {
			session = await this._sessions.ensure(name);
		} catch {
			return null;
		}
		const chosen = await session.model();
		try {
			return this._models.resolve(chosen ?? undefined).provider;
		} catch {
			return null;
		}
	}
}

const providersExtension: Extension = {
	id: "providers",
	apiVersion: 1,

	activate(context) {
		const accounts = new ProviderAccounts(context.config, context.models, context.get(ISessionService));
		context.disposables.add({ dispose: () => accounts.dispose() });
		context.disposables.add(
			context.get(ICapabilityService).register("core.provider", {
				balance: (session?: unknown) => accounts.balance(typeof session === "string" && session !== "" ? session : null),
			}),
		);
	},
};

export default providersExtension;
