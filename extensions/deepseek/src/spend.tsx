import { api, React } from "./runtime.ts";

/** A reply costs cents at most, so the digits follow the magnitude: a cheap one keeps five. */
const usd = (value: number): string => {
	const digits = value < 0.01 ? 5 : value < 1 ? 3 : 2;
	return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: digits }).format(value);
};

const tokens = (value: number): string => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);

interface MessageRow {
	readonly kind?: string;
	readonly usage?: { readonly totalTokens: number; readonly cost: number };
	readonly model?: { readonly provider: string };
}

/** One reply's price, straight from the row the shell hands over — the host is not asked anything. */
export function SpendChip() {
	const { data } = api.useWidget();
	const row = data as MessageRow | undefined;
	if (row === undefined || row.kind !== "assistant" || row.usage === undefined) return null;
	if (row.model?.provider !== "deepseek") return null;
	const style = { fontFamily: "var(--mono)", fontSize: 10, fontVariantNumeric: "tabular-nums", color: "var(--muted-soft)" } as const;
	return (
		<api.Tip label={`${tokens(row.usage.totalTokens)} tokens · ${usd(row.usage.cost)} · priced from the model catalog`}>
			<span style={style}>{usd(row.usage.cost)}</span>
		</api.Tip>
	);
}

export default SpendChip;
