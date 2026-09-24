import { type FSWatcher, watch } from "chokidar";
import { fileWatchTarget } from "./explorer";

const POLL_MS = 300;
const DEBOUNCE_MS = 120;

export interface FileWatch {
	arm(input: { key: string; rootPath: string; relPath: string | null }): Promise<{ ok: true } | { ok: false; error: string }>;
	stop(): void;
}

export function createFileWatch(onChanged: (relPath: string) => void): FileWatch {
	let current: { key: string; watcher: FSWatcher } | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function stop(): void {
		if (timer) clearTimeout(timer);
		timer = undefined;
		if (!current) return;
		void current.watcher.close();
		current = null;
	}

	function notify(relPath: string): void {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => onChanged(relPath), DEBOUNCE_MS);
	}

	async function arm(input: { key: string; rootPath: string; relPath: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
		if (current?.key === input.key) return { ok: true };
		stop();
		if (input.relPath === null) return { ok: true };
		try {
			const target = await fileWatchTarget(input.rootPath, input.relPath);
			const relPath = input.relPath;
			const watcher = watch(target, { ignoreInitial: true, usePolling: true, interval: POLL_MS });
			watcher.on("all", () => notify(relPath));
			watcher.on("error", () => {});
			current = { key: input.key, watcher };
			return { ok: true };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	return { arm, stop };
}
