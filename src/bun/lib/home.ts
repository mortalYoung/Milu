import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR } from "../../shared/home";

export function expandHome(path: string): string {
	return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

/** The absolute config root — the only place a filesystem call gets one. */
export function configDir(): string {
	return expandHome(CONFIG_DIR);
}

export function configPath(name: string): string {
	return join(configDir(), name);
}
