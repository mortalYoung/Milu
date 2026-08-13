import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// The view (src/mainview) is built by Vite into dist/; electrobun copies
// dist/index.html + dist/assets into the bundle (see electrobun.config.ts).
export default defineConfig({
	plugins: [solid(), tailwindcss()],
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
