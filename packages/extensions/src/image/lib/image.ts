import { isAbsolute, resolve } from "node:path";

import { type ExtensionContext, IExecutionService, ISelectionService, ISessionService, type Session } from "@milu/core";

const MIME: Record<string, string> = {
	".avif": "image/avif",
	".bmp": "image/bmp",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp",
};

const MAX_BYTES = 8 * 1024 * 1024;

export function isRemote(src: string): boolean {
	return /^(data:|https?:)/i.test(src);
}

function mimeOf(path: string): string | undefined {
	const at = path.lastIndexOf(".");
	const slash = path.lastIndexOf("/");
	return at <= slash ? undefined : MIME[path.slice(at).toLowerCase()];
}

export async function activeSession(context: ExtensionContext, session: Session | undefined): Promise<Session> {
	if (session !== undefined) return session;
	const selected = context.get(ISelectionService).selected;
	if (selected === null) throw new Error("no session is selected");
	return context.get(ISessionService).ensure(selected);
}

export async function imageDataUrl(context: ExtensionContext, session: Session, from: string | undefined, path: string): Promise<string> {
	const root = (await session.workspace())?.path ?? session.root;
	const target = isAbsolute(path) ? path : resolve(from ?? root, path);
	const mime = mimeOf(target);
	if (mime === undefined) throw new Error(`${target} is not an image`);
	const env = context.get(IExecutionService).env(root);
	const info = await env.fileInfo(target);
	if (info.ok && info.value.size > MAX_BYTES) throw new Error(`image is larger than ${MAX_BYTES / 1024 / 1024} MB`);
	const read = await env.readBinaryFile(target);
	if (!read.ok) throw new Error(read.error.message);
	return `data:${mime};base64,${Buffer.from(read.value).toString("base64")}`;
}
