import { useEffect } from "react";
import { useStore } from "zustand";

import type { ComposerDataEntry } from "../composer-data.ts";
import type { Host } from "../surfaces.ts";

const IDLE: ComposerDataEntry = { status: "idle" };

export function useComposerData<T>(host: Host, key: string): { readonly status: ComposerDataEntry["status"]; readonly data: T | undefined; readonly session: string } {
	const session = useStore(host.selection.store, (state) => state.selected);
	const entry = useStore(host.composerData.store, (state) => state.sessions[session] ?? IDLE);

	useEffect(() => {
		if (session !== "") void host.composerData.ensure(session);
	}, [host, session, entry.status]);

	return { status: entry.status, data: entry.data?.[key] as T | undefined, session };
}
