type ReactModule = typeof import("react");

export interface Activity {
	readonly session: string;
	readonly running: boolean;
	readonly compacting: boolean;
	readonly waiting: number;
	readonly error: string | null;
	readonly errorAt: number;
	readonly unread: boolean;
}

export interface Motion {
	readonly drag: "left" | "right" | null;
	readonly look: number | null;
}

interface BridgeApi {
	useSession(): string | null;
	useSessionActivity(session: string | null): Activity | null;
	useWindowMotion(): Motion;
	useExtensionData<T>(key: string): { readonly status: "loading" | "ready" | "error"; readonly data: T | undefined; readonly error?: string; refresh(): void };
	useCommand(): (command: string, ...args: unknown[]) => Promise<unknown>;
}

export const React = (globalThis as unknown as { miluHost: { react: ReactModule } }).miluHost.react;
export const api = (globalThis as unknown as { miluHost: { api: BridgeApi } }).miluHost.api;
export const { useEffect, useState } = React;
