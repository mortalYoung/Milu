import { join } from "node:path";

export function dwsEnv(root: string): Record<string, string> {
	return {
		DWS_CONFIG_DIR: join(root, "config"),
		DWS_KEYCHAIN_DIR: join(root, "keychain"),
		DWS_PERF_REPORT: join(root, "perf", "latest.json"),
		DWS_DISABLE_KEYCHAIN: "1",
	};
}
