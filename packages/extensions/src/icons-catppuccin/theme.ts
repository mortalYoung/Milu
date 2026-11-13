import type { IconTheme } from "@milu/window/api";

import { EXTENSIONS, NAMES } from "./catalog.ts";
import { GLYPHS } from "./glyphs.ts";

const TOKENS: Readonly<Record<string, string>> = {
	rosewater: "light-dark(#dc8a78, #f5e0dc)",
	flamingo: "light-dark(#dd7878, #f2cdcd)",
	pink: "light-dark(#ea76cb, #f5c2e7)",
	mauve: "light-dark(#8839ef, #cba6f7)",
	red: "light-dark(#d20f39, #f38ba8)",
	maroon: "light-dark(#e64553, #eba0ac)",
	peach: "light-dark(#fe640b, #fab387)",
	yellow: "light-dark(#df8e1d, #f9e2af)",
	green: "light-dark(#40a02b, #a6e3a1)",
	teal: "light-dark(#179299, #94e2d5)",
	sky: "light-dark(#04a5e5, #89dceb)",
	sapphire: "light-dark(#209fb5, #74c7ec)",
	blue: "light-dark(#1e66f5, #89b4fa)",
	lavender: "light-dark(#7287fd, #b4befe)",
	text: "light-dark(#4c4f69, #cdd6f4)",
	overlay1: "light-dark(#8c8fa1, #7f849c)",
};

export const CATPPUCCIN: IconTheme = {
	id: "catppuccin",
	title: "Catppuccin",
	file: "_file",
	directory: "_folder",
	directoryOpen: "_folder_open",
	glyphs: GLYPHS,
	extensions: EXTENSIONS,
	names: NAMES,
	tokens: TOKENS,
};
