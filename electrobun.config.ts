import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Letters",
		identifier: "letters.local",
		version: "0.1.0",
	},
	build: {
		// v2: the main process runtime is explicit — bun, not the cottontail default.
		mainProcess: "bun",
		bun: {
			entrypoint: "src/bun/index.ts",
		},
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
			icons: "assets/icon.iconset",
		},
		linux: {
			bundleCEF: false,
			icon: "assets/letters.png",
		},
		win: {
			bundleCEF: false,
			icon: "assets/letters.png",
		},
	},
} satisfies ElectrobunConfig;
