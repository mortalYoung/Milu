import { type Accessor, createContext, type JSX, useContext } from "solid-js";
import type { MetricsData } from "../metrics";

const MetricsContext = createContext<Accessor<MetricsData | undefined> | undefined>(undefined);

export function MetricsProvider(props: { value: Accessor<MetricsData | undefined>; children?: JSX.Element }) {
	return <MetricsContext.Provider value={props.value}>{props.children}</MetricsContext.Provider>;
}

export function useMetrics(): Accessor<MetricsData | undefined> {
	const ctx = useContext(MetricsContext);
	if (!ctx) throw new Error("useMetrics must be used within MetricsProvider");
	return ctx;
}
