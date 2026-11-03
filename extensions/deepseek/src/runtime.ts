type ReactModule = typeof import("react");

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

interface BridgeApi {
	useWidget(): { readonly id: string; readonly data: unknown };
	useSession(): string | null;
	useExtensionData<T>(key: string): { readonly status: "loading" | "ready" | "error"; readonly data: T | undefined; readonly error?: string };
	useCommand(): (command: string, ...args: unknown[]) => Promise<unknown>;
	Tip: (props: { readonly label?: unknown; readonly children: unknown }) => unknown;
}

export const React = (globalThis as unknown as { miluHost: { react: ReactModule } }).miluHost.react;
export const api = (globalThis as unknown as { miluHost: { api: BridgeApi } }).miluHost.api;
export const { useEffect, useState } = React;
