import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev the page is served by Vite, so the socket is proxied to the app server on its fixed port.
// The target must be the IPv4 literal: the server binds 127.0.0.1, while Vite itself listens on [::1].
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
