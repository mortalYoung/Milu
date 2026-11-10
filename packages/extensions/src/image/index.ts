import type { Extension } from "@milu/core";

import { activeSession, imageDataUrl, isRemote } from "./lib/image.ts";

interface PreviewArgs {
	readonly src?: unknown;
	readonly alt?: unknown;
}

interface ResolveArgs {
	readonly from?: unknown;
	readonly path?: unknown;
}

const imageExtension: Extension = {
	id: "image",
	apiVersion: 1,

	widgets: [
		{ id: "image.zoom", type: "markdown", entry: "./widget/plugin.ts", export: "imageZoomPlugin" },
		{ id: "image.preview", type: "dialog", entry: "./widget/preview.tsx", export: "ImagePreview" },
	],

	activate(context) {
		context.actions.register({
			id: "image.preview",
			run: async ({ session, args, dialog }) => {
				if (dialog === undefined) return;
				const value = (args ?? {}) as PreviewArgs;
				const source = typeof value.src === "string" ? value.src : "";
				if (source === "") return;
				const alt = typeof value.alt === "string" ? value.alt : "";
				const title = alt === "" ? "Image" : alt;

				if (isRemote(source)) {
					await dialog({ kind: "custom", id: "image.preview", title, data: { src: source, alt } });
					return;
				}

				try {
					const src = await imageDataUrl(context, await activeSession(context, session), undefined, source);
					await dialog({ kind: "custom", id: "image.preview", title, data: { src, alt } });
				} catch (error) {
					await dialog({ kind: "custom", id: "image.preview", title, data: { src: "", alt, error: error instanceof Error ? error.message : String(error) } });
				}
			},
		});

		context.actions.register({
			id: "image.resolve",
			run: async ({ session, args }) => {
				const value = (args ?? {}) as ResolveArgs;
				const from = typeof value.from === "string" ? value.from : undefined;
				const path = typeof value.path === "string" ? value.path : "";
				if (path === "") throw new Error("image.resolve needs a path");
				return { data: { src: path, dataUrl: await imageDataUrl(context, await activeSession(context, session), from, path) } };
			},
		});
	},
};

export default imageExtension;
