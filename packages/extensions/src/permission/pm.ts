import { homedir } from "node:os";
import { join } from "node:path";

export const PM_CACHE = join(homedir(), "Library", "Caches", "Milu", "pm");

export function packageManagerEnv(cache: string): Record<string, string> {
	return {
		BUN_INSTALL_CACHE_DIR: cache,
		npm_config_cache: cache,
		YARN_CACHE_FOLDER: cache,
		YARN_GLOBAL_FOLDER: cache,
	};
}
