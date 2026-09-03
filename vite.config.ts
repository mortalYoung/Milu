import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite.ts";

// The view (src/mainview) is built by Vite into dist/; electrobun copies
// dist/index.html + dist/assets into the bundle (see electrobun.config.ts).
// v2 SDK imports (electrobun/view) resolve from the Hutch-projected devkit.
export default defineConfig({
	plugins: [solid(), tailwindcss()],
	resolve: {
		alias: electrobunViteAliases(".hutch/devkit"),
	},
	root: "src/mainview",
	// relative asset URLs — the view is served from views://, not a web root
	base: "./",
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
