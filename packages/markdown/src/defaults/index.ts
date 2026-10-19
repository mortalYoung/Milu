import type { MarkdownPlugin } from "../types.ts";
import { cjkPlugin } from "./cjk.ts";
import { copyPlugin } from "./copy.ts";
import { linksPlugin } from "./links.ts";
import { normalizePlugin } from "./normalize.ts";
import { shikiPlugin } from "./shiki.ts";

export const DEFAULT_PLUGINS: readonly MarkdownPlugin[] = [normalizePlugin, cjkPlugin, linksPlugin, shikiPlugin, copyPlugin];
