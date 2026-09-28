import { createStore } from "zustand/vanilla";
import type { CustomProvider, SandboxMode, ThemeMode, ToastPlacement } from "../../shared/rpc";
import type { RPC } from "./rpc";
import type { Toast } from "./toast";

export interface SettingsData {
	partner_profile_path: string;
	detect_instructions_file: string;
	defaultSandboxMode?: SandboxMode;
	providers?: string[];
	customProviders?: CustomProvider[];
	theme?: ThemeMode;
	toastPlacement?: ToastPlacement;
	dockSide?: "left" | "right";
	toastDurationMs?: number;
	skills_dirs?: string[];
	skills_watch?: boolean;
	skills_watch_delay_ms?: number;
	sendMessageIntervalSec?: number | null;
	shellContinuous?: boolean;
	memoryEnabled?: boolean;
	memoryIdleMinutes?: number;
	memoryMaxScenes?: number;
	memoryPendingRounds?: number;
	commands_path?: string;
	retry?: { maxRetries?: number; baseDelayMs?: number };
	bash?: { timeoutSec?: number };
	delete?: { strict?: boolean };
	webFetch?: { timeoutMs?: number; maxBytes?: number; maxChars?: number; userAgent?: string };
	compaction?: {
		thresholdRatio?: number;
		digestMaxItems?: number;
		maxOverflowRetries?: number;
		prune?: { thresholdChars?: number; headChars?: number; tailChars?: number };
	};
	explorer?: { lineGap?: number; fold?: { braces?: boolean; markdown?: boolean } };
	highlight?: { tokenizeMaxLineLength?: number; tokenizeTimeLimit?: number };
	palette?: { searchIgnoreDirs?: string[] };
}

export interface RuntimeInfo {
	providers: { id: string; configured: boolean; baseUrl?: string; modelCount: number }[];
	allProviders: string[];
}

export interface SaveResult {
	ok: boolean;
	error?: string;
}

const EMPTY = { settings: null as SettingsData | null, runtime: null as RuntimeInfo | null };

export function createSettings(rpc: RPC, toast: Toast) {
	const store = createStore<{ snapshot: typeof EMPTY; open: boolean }>()(() => ({ snapshot: EMPTY, open: false }));
	let flipTimer: ReturnType<typeof setTimeout> | undefined;

	function applyTheme(theme: ThemeMode) {
		const root = document.documentElement;
		if (root.dataset["theme"] === theme) return;
		const flipping = root.dataset["theme"] !== undefined;
		root.dataset["theme"] = theme;
		clearTimeout(flipTimer);
		if (flipping) {
			root.classList.add("theme-flip");
			flipTimer = setTimeout(() => root.classList.remove("theme-flip"), 300);
		}
	}

	function applySnapshot() {
		const settings = store.getState().snapshot.settings;
		applyTheme(settings?.theme ?? "system");
		if (typeof settings?.toastDurationMs === "number") toast.setDurationMs(settings.toastDurationMs);
	}

	function install() {
		applySnapshot();
		store.subscribe((state, previous) => {
			if (state.snapshot === previous.snapshot) return;
			applySnapshot();
		});
	}

	async function refresh() {
		try {
			const { settings, runtime } = await rpc.request.get_settings({});
			store.setState({ snapshot: { settings, runtime } });
		} catch (error) {
			toast.push({ title: "Settings failed to load", body: error instanceof Error ? error.message : String(error) }, "error");
			store.setState({ snapshot: EMPTY });
		}
	}

	async function save(settings: SettingsData, credentials: Record<string, string>): Promise<SaveResult> {
		const res = await rpc.request.update_settings({ settings, credentials });
		if (res.ok) void refresh();
		return res;
	}

	return {
		store,
		refresh,
		install,
		open: () => store.getState().open,
		mutate: { setOpen: (open: boolean) => store.setState({ open }), save },
	};
}
