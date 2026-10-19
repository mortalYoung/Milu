import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = "http://127.0.0.1:8787";

export default defineConfig({
	plugins: [react()],
	base: "./",
	build: { outDir: "dist", emptyOutDir: true },
	server: {
		port: 5173,
		strictPort: true,
		proxy: { "/ws": { target, ws: true } },
	},
});
