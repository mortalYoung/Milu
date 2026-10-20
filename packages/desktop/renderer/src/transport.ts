import type { ServerEvent, Transport } from "@milu/extensions/host";
import type { MethodName, Params, Result, Snapshot } from "@milu/protocol";

interface BridgeFrame {
	readonly ok: boolean;
	readonly result?: unknown;
	readonly error?: { readonly message?: string; readonly code?: string };
}

interface Bridge {
	connect(): Promise<Snapshot>;
	request(method: string, params: unknown): Promise<BridgeFrame>;
	subscribe(handler: (event: ServerEvent) => void): () => void;
}

function bridge(): Bridge {
	return (window as unknown as { milu: Bridge }).milu;
}

export class IpcTransport implements Transport {
	private readonly _listeners = new Set<(event: ServerEvent) => void>();
	private _unsubscribe: (() => void) | null = null;

	connect(): Promise<Snapshot> {
		if (!this._unsubscribe) {
			this._unsubscribe = bridge().subscribe((event) => {
				for (const listener of this._listeners) listener(event);
			});
		}
		return bridge().connect();
	}

	subscribe(handler: (event: ServerEvent) => void): () => void {
		this._listeners.add(handler);
		return () => this._listeners.delete(handler);
	}

	async request<K extends MethodName>(method: K, params: Params<K>): Promise<Result<K>> {
		const frame = await bridge().request(method, params);
		if (frame.ok !== true) throw new Error(frame.error?.message ?? frame.error?.code ?? `request "${method}" failed`);
		return frame.result as Result<K>;
	}

	close(): void {
		this._unsubscribe?.();
		this._unsubscribe = null;
		this._listeners.clear();
	}
}
