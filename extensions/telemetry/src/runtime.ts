type ReactModule = typeof import("react");

interface BridgeApi {
	useSession(): string | null;
}

export const React = (globalThis as unknown as { miluHost: { react: ReactModule } }).miluHost.react;
export const api = (globalThis as unknown as { miluHost: { api: BridgeApi } }).miluHost.api;
export const { useEffect, useState } = React;
