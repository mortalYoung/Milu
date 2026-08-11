import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "coding-desktop",
		identifier: "coding.desktop.local",
		version: "0.1.0",
	},
	build: {
		// The view is built by Vite (vite.config.ts) into dist/ — copy from there.
		// fonts are bundled into dist/assets by Vite (see src/mainview/style.css @font-face).
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		// Vite output is ignored by electrobun's watch — Vite rebuilds the view.
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
