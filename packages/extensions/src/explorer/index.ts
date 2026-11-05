import { dirname, isAbsolute, relative, resolve } from "node:path";

import { type Extension, IExecutionService, type Session, IWatchService } from "@milu/core";

import { openInFinder } from "../open/openers.ts";
import { gitignoreOf, isIgnoredPath } from "./ignore.ts";
import type { ExplorerEntry, ExplorerFile, ExplorerListing } from "./types.ts";

const HIDDEN = new Set([".DS_Store", ".git"]);
const MAX_BYTES = 512 * 1024;
const BINARY = new Set([
	".avif",
	".bmp",
	".class",
	".dmg",
	".dylib",
	".exe",
	".gif",
	".gz",
	".icns",
	".ico",
	".jpeg",
	".jpg",
	".m4a",
	".mkv",
	".mov",
	".mp3",
	".mp4",
	".o",
	".ogg",
	".otf",
	".pdf",
	".png",
	".pyc",
	".rar",
	".so",
	".tar",
	".ttf",
	".wav",
	".wasm",
	".webm",
	".webp",
	".woff",
	".woff2",
	".zip",
]);

const workspaceOnly = async (session: Session): Promise<true | null> => ((await session.workspace()) === null ? null : true);

const IMAGE_MIME: Record<string, string> = {
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
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const extensionOf = (path: string): string => {
	const at = path.lastIndexOf(".");
	const slash = path.lastIndexOf("/");
	return at <= slash ? "" : path.slice(at).toLowerCase();
};

const explorerExtension: Extension = {
	id: "explorer",
	apiVersion: 1,

	widgets: [
		{ id: "explorer.bar", type: "slot", entry: "./widget/explorer.tsx", export: "ExplorerButton" },
		{ id: "explorer.head", type: "slot", entry: "./widget/explorer.tsx", export: "ExplorerHead" },
		{ id: "explorer.pane", type: "slot", entry: "./widget/explorer.tsx", export: "ExplorerPane" },
		{ id: "explorer.tree", type: "service", entry: "./widget/service.ts" },
	],

	contributions: {
		"chat.bar": [{ id: "explorer", order: 40, component: "explorer.bar", data: workspaceOnly }],
		"dock.bar": [{ id: "explorer", order: 10, component: "explorer.head", data: workspaceOnly }],
		"dock.views": [{ id: "explorer", order: 20, component: "explorer.pane", title: "Explorer", icon: "folder-tree", data: workspaceOnly }],
	},

	activate(context) {
		const execution = context.get(IExecutionService);
		const rootOf = async (session: Session): Promise<string> => (await session.workspace())?.path ?? session.root;
		const pathOf = (args: unknown): string => {
			const path = (args as { path?: string } | undefined)?.path;
			if (!path) throw new Error("explorer needs a path");
			return path;
		};

		context.actions.register({
			id: "explorer.list",
			run: async ({ session, args }) => {
				if (!session) throw new Error("explorer.list needs a session");
				const root = await rootOf(session);
				const path = (args as { path?: string } | undefined)?.path ?? root;
				const listed = await execution.env(root).listDir(path);
				if (!listed.ok) throw new Error(listed.error.message);
				const patterns = await gitignoreOf(root);
				const entries: ExplorerEntry[] = listed.value
					.filter((entry) => !HIDDEN.has(entry.name))
					.map((entry) => ({
						name: entry.name,
						path: entry.path,
						kind: entry.kind,
						size: entry.size,
						...(isIgnoredPath(relative(root, entry.path), entry.kind, patterns) ? { ignored: true } : {}),
					}))
					.sort((left, right) => Number(right.kind === "directory") - Number(left.kind === "directory") || left.name.localeCompare(right.name));
				return { data: { root, path, entries } satisfies ExplorerListing };
			},
		});

		context.actions.register({
			id: "explorer.read",
			run: async ({ session, args }) => {
				if (!session) throw new Error("explorer.read needs a session");
				const path = pathOf(args);
				const env = execution.env(await rootOf(session));
				const info = await env.fileInfo(path);
				const size = info.ok ? info.value.size : 0;
				if (info.ok && size > MAX_BYTES) return { data: { path, text: "", size, truncated: true } satisfies ExplorerFile };
				const read = await env.readTextFile(path);
				if (!read.ok) throw new Error(read.error.message);
				const binary = BINARY.has(extensionOf(path)) || read.value.includes("\u0000");
				return { data: { path, text: binary ? "" : read.value, size, ...(binary ? { binary: true } : {}) } satisfies ExplorerFile };
			},
		});

		context.actions.register({
			id: "explorer.image",
			run: async ({ session, args }) => {
				if (!session) throw new Error("explorer.image needs a session");
				const { from, path } = (args ?? {}) as { from?: string; path?: string };
				if (from === undefined || path === undefined) throw new Error("explorer.image needs the document and the image path");
				const target = isAbsolute(path) ? path : resolve(dirname(from), path);
				const mime = IMAGE_MIME[extensionOf(target)];
				if (mime === undefined) throw new Error(`${extensionOf(target) || "this file"} is not an image`);
				const env = execution.env(await rootOf(session));
				const info = await env.fileInfo(target);
				if (info.ok && info.value.size > MAX_IMAGE_BYTES) throw new Error(`image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
				const read = await env.readBinaryFile(target);
				if (!read.ok) throw new Error(read.error.message);
				return { data: { src: path, dataUrl: `data:${mime};base64,${Buffer.from(read.value).toString("base64")}` } };
			},
		});

		const watching = new Map<string, { dispose(): void }>();
		context.disposables.add({
			dispose: () => {
				for (const each of watching.values()) each.dispose();
				watching.clear();
			},
		});

		context.actions.register({
			id: "explorer.watch",
			run: ({ args }) => {
				const path = pathOf(args);
				if (!watching.has(path)) watching.set(path, context.get(IWatchService).watch(path));
			},
		});

		context.actions.register({
			id: "explorer.unwatch",
			run: ({ args }) => {
				const path = pathOf(args);
				watching.get(path)?.dispose();
				watching.delete(path);
			},
		});

		context.actions.register({
			id: "explorer.reveal",
			run: async ({ args }) => {
				const opened = await openInFinder(pathOf(args));
				if (!opened.ok) throw new Error(`could not reveal ${opened.reason}`);
			},
		});
	},
};

export default explorerExtension;
