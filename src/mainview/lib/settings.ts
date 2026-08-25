import { createSignal } from "solid-js";
import { type RuntimeInfo, type SaveResult, type SettingsData } from "../pages/SettingsView";
import type { RPC } from "./rpc";

/** Settings dialog data (partner profile root, detected instructions file) + runtime info (providers). */
export function createSettings(rpc: RPC) {
	const [settings, setSettings] = createSignal<SettingsData | null>(null);
	const [runtime, setRuntime] = createSignal<RuntimeInfo | null>(null);

	async function refresh() {
		const { settings: s, runtime: r } = await rpc.request.get_settings({});
		setSettings(s);
		setRuntime(r);
	}

	async function save(s: SettingsData, credentials: Record<string, string>): Promise<SaveResult> {
		const res = await rpc.request.update_settings({ settings: s, credentials });
		if (res.ok) setSettings(s);
		return res;
	}

	return { settings, runtime, refresh, save };
}
