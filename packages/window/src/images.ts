import { createServiceId, type Service } from "@milu/di";
import type { ImageMediaType, ImageRef } from "@milu/protocol";
import { useEffect, useState } from "react";

import { type Connection, IConnection } from "./connection.ts";

interface Entry {
	promise: Promise<string>;
	url?: string;
}

function keyOf(session: string, attachmentId: string): string {
	return `${session}\u0000${attachmentId}`;
}

function blobBytes(data: Uint8Array): ArrayBuffer {
	return data.slice().buffer as ArrayBuffer;
}

/** Session-authorized image URLs shared by every transcript target. */
export class ImageService implements Service {
	private readonly _entries = new Map<string, Entry>();

	constructor(@IConnection private readonly _connection: Connection) {}

	peek(session: string, attachmentId: string): string | undefined {
		return this._entries.get(keyOf(session, attachmentId))?.url;
	}

	url(session: string, attachmentId: string, mediaType: ImageMediaType): Promise<string> {
		const key = keyOf(session, attachmentId);
		const existing = this._entries.get(key);
		if (existing !== undefined) return existing.promise;
		const entry: Entry = { promise: Promise.resolve("") };
		this._entries.set(key, entry);
		entry.promise = this._connection
			.request("attachment", { session, id: attachmentId })
			.then((result) => {
				const url = URL.createObjectURL(new Blob([blobBytes(result.data)], { type: mediaType }));
				entry.url = url;
				return url;
			})
			.catch((error: unknown) => {
				if (this._entries.get(key) === entry) this._entries.delete(key);
				throw error;
			});
		return entry.promise;
	}

	dispose(): void {
		for (const entry of this._entries.values()) {
			if (entry.url !== undefined) URL.revokeObjectURL(entry.url);
		}
		this._entries.clear();
	}
}

/** Resolve one durable image to a cached browser URL, loading it on first use. */
export function useImageUrl(images: Pick<ImageService, "peek" | "url">, session: string, ref: ImageRef): string | undefined {
	const attachmentId = ref.attachmentId;
	const mediaType = ref.mediaType;
	const cached = images.peek(session, attachmentId);
	const [loaded, setLoaded] = useState<{ readonly id: string; readonly url: string } | undefined>(undefined);
	useEffect(() => {
		if (cached !== undefined) return;
		let live = true;
		void images
			.url(session, attachmentId, mediaType)
			.then((value) => {
				if (live) setLoaded({ id: attachmentId, url: value });
			})
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, [images, session, attachmentId, mediaType, cached]);
	return cached ?? (loaded?.id === attachmentId ? loaded.url : undefined);
}

export const IImageService = createServiceId<ImageService>("ImageService");
