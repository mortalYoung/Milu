import type { FrontEndService } from "@milu/window/api";
import { createServiceId, IIconsService, type IconsService, type Service } from "@milu/window/api";

import { CATPPUCCIN } from "../theme.ts";

class CatppuccinIcons implements Service {
	constructor(private readonly _icons: IconsService) {}

	initialize(): void {
		this._icons.register(CATPPUCCIN);
	}

	dispose(): void {}
}

const ICatppuccinIcons = createServiceId<CatppuccinIcons>("icons.catppuccin");

export default {
	id: ICatppuccinIcons,
	create: (container) => new CatppuccinIcons(container.get(IIconsService)),
} satisfies FrontEndService;
