import { createHash, randomUUID } from "node:crypto";
import { chmod, link, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageMediaType, ImageRef, PromptImage } from "@milu/protocol";

import { probeImage } from "./probe.ts";

export interface ImageLimits {
	readonly maxBytes: number;
	readonly maxPixels: number;
	readonly maxPerMessage: number;
}

export const DEFAULT_IMAGE_LIMITS: ImageLimits = { maxBytes: 10 * 1024 * 1024, maxPixels: 20_000_000, maxPerMessage: 8 };

export interface ImageStoreOptions {
	readonly partnerRoot: string;
	readonly sessionRoot: string;
	/** Resolved limits, or a getter read on every use so Settings edits apply immediately. */
	readonly limits?: ImageLimits | (() => ImageLimits);
	/** Session root other than this one that already holds the digest, when known. */
	readonly ownerOf?: (sha256: string) => string | undefined;
	readonly remember?: (sha256: string, sessionRoot: string) => void;
	/** Cross-session hint scan, run at most once before the first commit. */
	readonly prepare?: () => Promise<void>;
}

export interface DurableImage {
	readonly type: "image";
	readonly attachment: ImageRef;
}

interface WireImage {
	readonly type: "image";
	readonly data: string;
	readonly mimeType: string;
}

const ID_PATTERN = /^sha256:([0-9a-f]{64})$/;

/** Pool directory shared by every session under one partner root. */
export function poolObjects(partnerRoot: string): string {
	return join(partnerRoot, ".attachments", "objects");
}

function isEexist(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST";
}

function isEnoent(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

/** Canonical base64 for one image payload headed to a provider. */
export function encodeImageBytes(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

function digest(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function shaOf(attachmentId: string): string {
	const match = ID_PATTERN.exec(attachmentId);
	if (match?.[1] === undefined) throw new Error("attachment id is not a sha256 digest");
	return match[1];
}

function wireImage(block: unknown): WireImage | undefined {
	if (typeof block !== "object" || block === null) return undefined;
	const value = block as { type?: unknown; data?: unknown; mimeType?: unknown };
	if (value.type !== "image" || typeof value.data !== "string" || typeof value.mimeType !== "string") return undefined;
	return { type: "image", data: value.data, mimeType: value.mimeType };
}

function durableImage(block: unknown): DurableImage | undefined {
	if (typeof block !== "object" || block === null) return undefined;
	const value = block as { type?: unknown; attachment?: unknown };
	if (value.type !== "image" || typeof value.attachment !== "object" || value.attachment === null) return undefined;
	const attachment = value.attachment as { type?: unknown };
	if (attachment.type !== "image") return undefined;
	return { type: "image", attachment: value.attachment as ImageRef };
}

function blocksOf(message: AgentMessage): readonly unknown[] | undefined {
	const content = (message as { content?: unknown }).content;
	return Array.isArray(content) ? content : undefined;
}

/** Content-addressed image store scoped to one partner directory and one session. */
export class ImageStore {
	readonly partnerRoot: string;
	readonly sessionObjects: string;
	readonly poolObjects: string;
	private readonly _options: ImageStoreOptions;
	private _prepared: Promise<void> | null = null;

	constructor(options: ImageStoreOptions) {
		this._options = options;
		this.partnerRoot = options.partnerRoot;
		this.sessionObjects = join(options.sessionRoot, ".attachments", "objects");
		this.poolObjects = poolObjects(options.partnerRoot);
	}

	get limits(): ImageLimits {
		const limits = this._options.limits;
		if (typeof limits === "function") return limits();
		return limits ?? DEFAULT_IMAGE_LIMITS;
	}

	/** Validate the batch shape, then commit every image in order. */
	async admit(images: readonly PromptImage[]): Promise<readonly ImageRef[]> {
		if (images.length > this.limits.maxPerMessage) throw new Error(`a message may carry at most ${this.limits.maxPerMessage} images`);
		if (images.length === 0) return [];
		await this._prepare();
		const refs: ImageRef[] = [];
		for (const image of images) refs.push(await this.save(image));
		return refs;
	}

	async save(image: PromptImage): Promise<ImageRef> {
		await this._prepare();
		if (image.data.byteLength === 0) throw new Error("image is empty");
		if (image.data.byteLength > this.limits.maxBytes) throw new Error(`image exceeds the ${Math.floor(this.limits.maxBytes / (1024 * 1024))}MB limit`);
		const probed = probeImage(image.data);
		if (probed === undefined) throw new Error("image format is not supported");
		if (probed.mediaType !== image.mediaType) throw new Error("declared image type does not match its bytes");
		if (probed.width * probed.height > this.limits.maxPixels) throw new Error(`image exceeds the ${this.limits.maxPixels} pixel limit`);

		const sha256 = digest(image.data);
		const ref: ImageRef = {
			type: "image",
			attachmentId: `sha256:${sha256}`,
			mediaType: probed.mediaType,
			bytes: image.data.byteLength,
			width: probed.width,
			height: probed.height,
			...(image.name === undefined || image.name === "" ? {} : { name: image.name }),
		};

		const pool = join(this.poolObjects, sha256);
		const local = join(this.sessionObjects, sha256);
		if (await this._exists(pool)) {
			await this._link(pool, local);
			return ref;
		}
		const owner = this._options.ownerOf?.(sha256);
		if (owner !== undefined && owner !== this._options.sessionRoot) {
			const source = join(owner, ".attachments", "objects", sha256);
			if (await this._link(source, pool)) {
				await this._link(pool, local);
				this._options.remember?.(sha256, this._options.sessionRoot);
				return ref;
			}
		}
		await this._publish(this.sessionObjects, sha256, image.data);
		this._options.remember?.(sha256, this._options.sessionRoot);
		return ref;
	}

	async read(ref: ImageRef): Promise<Uint8Array> {
		const sha256 = shaOf(ref.attachmentId);
		for (const directory of [this.sessionObjects, this.poolObjects]) {
			try {
				const data = new Uint8Array(await readFile(join(directory, sha256)));
				if (digest(data) !== sha256 || data.byteLength !== ref.bytes) throw new Error(`stored image ${ref.attachmentId} does not match its reference`);
				return data;
			} catch (error) {
				if (isEnoent(error)) continue;
				throw error;
			}
		}
		throw new Error(`stored image ${ref.attachmentId} is missing`);
	}

	/** Replace wire image blocks with durable references; unreadable images degrade to text. */
	async durable(message: AgentMessage): Promise<AgentMessage> {
		const blocks = blocksOf(message);
		if (blocks === undefined) return message;
		const next = await Promise.all(
			blocks.map(async (block) => {
				const image = wireImage(block);
				if (image === undefined) return block;
				if (durableImage(block) !== undefined) return block;
				const mediaType = image.mimeType as ImageMediaType;
				try {
					const ref = await this.save({ mediaType, data: new Uint8Array(Buffer.from(image.data, "base64")) });
					return { type: "image", attachment: ref } satisfies DurableImage;
				} catch (error) {
					return { type: "text", text: `[image omitted: ${error instanceof Error ? error.message : String(error)}]` };
				}
			}),
		);
		return { ...message, content: next } as AgentMessage;
	}

	/** Replace durable image references with wire blocks the provider accepts. */
	async wire(message: AgentMessage): Promise<AgentMessage> {
		const blocks = blocksOf(message);
		if (blocks === undefined) return message;
		let changed = false;
		const next = await Promise.all(
			blocks.map(async (block) => {
				const durable = durableImage(block);
				if (durable === undefined) return block;
				changed = true;
				try {
					const data = await this.read(durable.attachment);
					return { type: "image", data: encodeImageBytes(data), mimeType: durable.attachment.mediaType } satisfies WireImage;
				} catch {
					return { type: "text", text: `[image omitted: ${durable.attachment.attachmentId} is no longer readable]` };
				}
			}),
		);
		return changed ? ({ ...message, content: next } as AgentMessage) : message;
	}

	private _prepare(): Promise<void> {
		this._prepared ??= this._options.prepare?.() ?? Promise.resolve();
		return this._prepared;
	}

	private async _exists(path: string): Promise<boolean> {
		try {
			await stat(path);
			return true;
		} catch (error) {
			if (isEnoent(error)) return false;
			throw error;
		}
	}

	private async _link(source: string, target: string): Promise<boolean> {
		if (source === target) return this._exists(target);
		await mkdir(dirname(target), { recursive: true, mode: 0o700 });
		try {
			await link(source, target);
			return true;
		} catch (error) {
			if (isEexist(error)) return true;
			if (isEnoent(error)) return false;
			throw error;
		}
	}

	private async _publish(directory: string, sha256: string, data: Uint8Array): Promise<void> {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const target = join(directory, sha256);
		const temporary = join(directory, `.${randomUUID()}.tmp`);
		try {
			await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
			await link(temporary, target);
		} catch (error) {
			if (!isEexist(error)) throw error;
		} finally {
			await unlink(temporary).catch(() => undefined);
		}
		await chmod(target, 0o400).catch(() => undefined);
	}
}

/** Drop pooled objects no session references any more (hard-link count of one). */
export async function collectPool(partnerRoot: string): Promise<number> {
	const directory = poolObjects(partnerRoot);
	let names: string[];
	try {
		names = await readdir(directory);
	} catch (error) {
		if (isEnoent(error)) return 0;
		throw error;
	}
	let removed = 0;
	for (const name of names) {
		if (name.startsWith(".")) continue;
		const path = join(directory, name);
		try {
			if ((await stat(path)).nlink > 1) continue;
			await unlink(path);
			removed += 1;
		} catch (error) {
			if (!isEnoent(error)) throw error;
		}
	}
	return removed;
}
