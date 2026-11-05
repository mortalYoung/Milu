import { api, type BalanceSnapshot, React } from "./runtime.ts";

const { useEffect, useState } = React;

const REFRESH_MS = 5 * 60 * 1000;

export const BALANCE_STYLE = `
.milu-ext-deepseek-balance {
	display: flex;
	flex: none;
	align-items: center;
	height: 26px;
	padding: 0 8px;
	border: 0;
	border-radius: 999px;
	background: transparent;
	color: var(--muted);
	font-family: var(--mono);
	font-size: 11px;
	font-variant-numeric: tabular-nums;
	cursor: pointer;
	transition: background-color 120ms var(--ease-out), color 120ms var(--ease-out);
}
.milu-ext-deepseek-balance:hover {
	background: var(--hover);
	color: var(--ink);
}
.milu-ext-deepseek-balance.is-empty {
	color: var(--signal);
}
`;

const money = (value: number, currency: string): string => {
	try {
		return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
	} catch {
		return `${currency} ${value.toFixed(2)}`;
	}
};

const detail = (snapshot: BalanceSnapshot): string =>
	snapshot.infos
		.map((info) => `${money(info.total, info.currency)}\n  granted ${money(info.granted, info.currency)} · topped up ${money(info.toppedUp, info.currency)}`)
		.join("\n");

export function BalancePill() {
	const session = api.useSession();
	const data = api.useExtensionData<BalanceSnapshot | null>("balance");
	const [busy, setBusy] = useState(false);
	const { refresh } = data;

	useEffect(() => {
		const timer = window.setInterval(refresh, REFRESH_MS);
		return () => window.clearInterval(timer);
	}, [session, refresh]);

	if (data.data === null || data.data === undefined || data.data.infos.length === 0) return null;
	const snapshot = data.data;
	const primary = snapshot.infos[0];
	if (primary === undefined) return null;
	const label = `${snapshot.available ? "" : "balance exhausted · "}${detail(snapshot)}`;

	return (
		<>
			<style>{BALANCE_STYLE}</style>
			<api.Tip label={label}>
				<button
					type="button"
					className={`milu-ext-deepseek-balance${snapshot.available ? "" : " is-empty"}`}
					aria-label={`DeepSeek balance ${money(primary.total, primary.currency)}`}
					aria-busy={busy || undefined}
					onClick={() => {
						setBusy(true);
						data.refresh();
						window.setTimeout(() => setBusy(false), 400);
					}}
				>
					{money(primary.total, primary.currency)}
				</button>
			</api.Tip>
		</>
	);
}

export default BalancePill;
