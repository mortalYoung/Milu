import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";

const DESKTOP = process.cwd();
const EXTENSIONS = join(DESKTOP, "..", "extensions", "src");

async function widgetInputs(): Promise<Record<string, string>> {
	const inputs: Record<string, string> = {};
	for (const extension of await readdir(EXTENSIONS, { withFileTypes: true })) {
		if (!extension.isDirectory()) continue;
		const directory = join(EXTENSIONS, extension.name, "widget");
		let files: string[];
		try {
			files = await readdir(directory);
		} catch {
			continue;
		}
		for (const file of files) {
			if (!/\.tsx?$/.test(file)) continue;
			inputs[`${extension.name}/widget/${file.replace(/\.tsx?$/, "")}`] = join(directory, file);
		}
	}
	return inputs;
}

function widgetManifest(inputs: Record<string, string>): Plugin {
	return {
		name: "milu-widget-manifest",
		generateBundle(_options, bundle) {
			const files: Record<string, string> = {};
			for (const output of Object.values(bundle)) {
				if (output.type === "chunk" && output.name in inputs) files[output.name] = output.fileName;
			}
			this.emitFile({ type: "asset", fileName: "widgets.json", source: `${JSON.stringify(files, null, "\t")}\n` });
		},
	};
}

export default defineConfig(async () => {
	const inputs = await widgetInputs();
	return {
		root: "renderer",
		plugins: [react(), tailwindcss(), widgetManifest(inputs)],
		base: "./",
		build: {
			outDir: "dist",
			emptyOutDir: true,
			rollupOptions: { input: { index: join(DESKTOP, "renderer/index.html"), ...inputs }, preserveEntrySignatures: "strict" },
		},
		server: {
			host: "127.0.0.1",
			port: 5173,
			strictPort: true,
			fs: { allow: [searchForWorkspaceRoot(DESKTOP), join(process.env["MILU_CONFIG"] ?? join(homedir(), ".config", "milu"), "extensions")] },
		},
	};
});
