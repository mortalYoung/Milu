import { IThemesService, type Extension } from "@milu/core";
import type { Theme, ThemeSettings } from "@milu/protocol";

const DEFAULTS: ThemeSettings = { mode: "system", light: "light", dark: "dark" };

const THEMES: readonly Theme[] = [
	{ id: "light", name: "Light", appearance: "light", tokens: {} },
	{ id: "dark", name: "Dark", appearance: "dark", tokens: {} },
	{
		id: "sepia",
		name: "Sepia",
		appearance: "light",
		tokens: {
			canvas: "#f4ecd8",
			chrome: "#efe4cc",
			surface: "#f8f2e2",
			ink: "#3b2f23",
			inkSoft: "#6b5a45",
			muted: "#8a7860",
			mutedSoft: "#a08d72",
			line: "#ddceb2",
			lineStrong: "#c4b190",
			signal: "#b5523b",
			accentTeal: "#4f7a6a",
			accentAmber: "#b8863b",
			codeBg: "#efe4cc",
			codeBlockBg: "#f4ecd8",
			codeHairline: "rgba(59, 47, 35, 0.05)",
			link: "#8a6a3f",
			caption: "#a89a86",
		},
	},
	{
		id: "nord",
		name: "Nord",
		appearance: "dark",
		tokens: {
			canvas: "#2e3440",
			chrome: "#292e39",
			surface: "#3b4252",
			ink: "#eceff4",
			inkSoft: "#d8dee9",
			muted: "#8f9aa9",
			mutedSoft: "#6b7688",
			line: "rgba(216, 222, 233, 0.12)",
			lineStrong: "#4c566a",
			signal: "#bf616a",
			accentTeal: "#88c0d0",
			accentAmber: "#ebcb8b",
			codeBg: "#292e39",
			codeBlockBg: "#2e3440",
			codeHairline: "rgba(255, 255, 255, 0.06)",
			link: "#8fbcbb",
			caption: "#5e6b7e",
		},
	},
];

const themeExtension: Extension = {
	id: "theme",
	apiVersion: 1,

	activate: async (context) => {
		const settings = context.settings.declare<ThemeSettings>({ key: "theme", defaults: DEFAULTS });
		const stored: unknown = settings.get();
		if (typeof stored !== "object" || stored === null || Array.isArray(stored)) await context.settings.update({ theme: DEFAULTS }).catch(() => undefined);
		const icons = context.settings.declare<string>({ key: "icons", defaults: "minimal" });

		for (const theme of THEMES) context.disposables.add(context.themes.register(theme));

		context.disposables.add(
			context.actions.register({
				id: "themes.state",
				run: () => ({
					data: {
						themes: context.get(IThemesService).list(),
						settings: settings.get(),
						icons: icons.get(),
					},
				}),
			}),
		);
	},
};

export default themeExtension;
