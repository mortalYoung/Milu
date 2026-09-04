import { createResource, createSignal } from "solid-js";
import { type RuntimeInfo, type SaveResult, type SettingsData } from "../pages/SettingsView";
import { useToast } from "./contexts/toast-context";
import type { RPC } from "./rpc";

const EMPTY = { settings: null as SettingsData | null, runtime: null as RuntimeInfo | null };

export function createSettings(rpc: RPC) {
	const toast = useToast();
	const [snapshot, { refetch }] = createResource(
		async () => {
			try {
				const { settings, runtime } = await rpc.request.get_settings({});
				return { settings, runtime };
			} catch (error) {
				toast.push({ title: "Settings failed to load", body: error instanceof Error ? error.message : String(error) }, "error");
				return EMPTY;
			}
		},
		{ initialValue: EMPTY },
	);
	const [open, setOpen] = createSignal(false);

	async function save(s: SettingsData, credentials: Record<string, string>): Promise<SaveResult> {
		const res = await rpc.request.update_settings({ settings: s, credentials });
		if (res.ok) void refetch();
		return res;
	}

	return {
		data: () => snapshot.latest,
		open,
		mutate: { setOpen, save },
	};
}
