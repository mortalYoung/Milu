import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

const DEV_URL = process.env["MILU_DEV_URL"]?.replace(/\/+$/, "");

let manifest: Promise<Record<string, string>> | null = null;

function files(): Promise<Record<string, string>> {
	manifest ??= readFile(join(app.getAppPath(), "renderer/dist/widgets.json"), "utf8")
		.then((raw) => JSON.parse(raw) as Record<string, string>)
		.catch(() => ({}));
	return manifest;
}

export async function widgetUrl(extension: string, entry: string, root?: string): Promise<string | undefined> {
	if (DEV_URL !== undefined) {
		const path = root === undefined ? join(app.getAppPath(), "..", "extensions", "src", extension, entry) : join(root, entry);
		return `${DEV_URL}/@fs${path}`;
	}
	if (root !== undefined) return `/extensions/${extension}/${entry}`;
	const key = `${extension}/${entry.replace(/^\.\//, "").replace(/\.tsx?$/, "")}`;
	const file = (await files())[key];
	return file === undefined ? undefined : `/${file}`;
}

export async function bootUrl(): Promise<string | undefined> {
	if (DEV_URL !== undefined) return `${DEV_URL}/src/window.tsx`;
	const file = (await files())["window"];
	return file === undefined ? undefined : `/${file}`;
}
