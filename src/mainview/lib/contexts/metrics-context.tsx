import { createContext, type ReactNode, useContext } from "react";
import type { createMetrics } from "../metrics";

export type Metrics = ReturnType<typeof createMetrics>;

const MetricsContext = createContext<Metrics | undefined>(undefined);

export function MetricsProvider(props: { value: Metrics; children?: ReactNode }) {
	return <MetricsContext.Provider value={props.value}>{props.children}</MetricsContext.Provider>;
}

export function useMetrics(): Metrics {
	const ctx = useContext(MetricsContext);
	if (!ctx) throw new Error("useMetrics must be used within MetricsProvider");
	return ctx;
}
