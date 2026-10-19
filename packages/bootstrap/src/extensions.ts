import type { Extension } from "@milu/core";
import { pinExtension } from "@milu/extension-pin";

/**
 * The compile-time loader: every extension this build ships. A runtime loader (directory scan +
 * dynamic import) will hand over the same `Extension` objects, so nothing above this line changes.
 */
export const EXTENSIONS: readonly Extension[] = [pinExtension];
