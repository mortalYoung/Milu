import type { Extension, Session } from "@milu/core";

export interface MeterWidgetData {
	readonly used: number;
	readonly projectedTokens?: number;
	readonly window: number;
	readonly percent: number;
	readonly breakdown: { readonly systemTokens: number; readonly toolsTokens: number; readonly messageTokens: number } | null;
}

export const meterExtension: Extension = {
	id: "meter",
	apiVersion: 1,

	contributions: {
		"composer.right": [{ id: "meter", order: 20, widget: "meter", data: (session: Session) => session.contextUsage() }],
	},
};
