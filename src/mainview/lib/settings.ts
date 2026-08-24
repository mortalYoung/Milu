import { createSignal } from "solid-js";
import type { SettingsData } from "../pages/SettingsView";
import type { RPC } from "./rpc";

/** Settings dialog data (partner profile root, detected instructions file) + runtime info (model, API key presence). */
export function createSettings(rpc: RPC) {
	const [settings, setSettings] = createSignal<SettingsData | null>(null);
	const [runtime, setRuntime] = createSignal<{ model: string; apiKeyConfigured: boolean } | null>(null);

	async function refresh() {
		const { settings: s, runtime: r } = await rpc.request.get_settings({});
		setSettings(s);
		setRuntime(r);
	}

	async function save(s: SettingsData) {
		await rpc.request.update_settings({ settings: s });
		setSettings(s);
	}

	return { settings, runtime, refresh, save };
}
