import type { LiveEvent, MethodName, Params, PartialMessage, Result, SeqEntry, Snapshot } from "@milu/protocol";

export type ServerEvent =
	| { readonly type: "snapshot"; readonly snapshot: Snapshot }
	| { readonly type: "entry"; readonly session: string; readonly entry: SeqEntry }
	| { readonly type: "partial"; readonly session: string; readonly message: PartialMessage }
	| { readonly type: "live"; readonly event: LiveEvent };

export interface Transport {
	connect(): Promise<Snapshot>;
	request<K extends MethodName>(method: K, params: Params<K>): Promise<Result<K>>;
	subscribe(handler: (event: ServerEvent) => void): () => void;
	close(): void;
}
