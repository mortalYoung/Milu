import type { SeqEntry } from "@milu/protocol";
import { useCallback, useEffect, useRef } from "react";
import { useStore } from "zustand";

import type { ComposerDataEntry } from "../composer-data.ts";
import type { Host } from "../surfaces.ts";

const IDLE: ComposerDataEntry = { status: "idle" };

export function useComposerData<T>(
	host: Host,
	key: string,
): {
	readonly status: ComposerDataEntry["status"];
	readonly data: T | undefined;
	readonly session: string;
	refresh(): void;
} {
	const session = useStore(host.selection.store, (state) => state.selected);
	const entry = useStore(host.composerData.store, (state) => state.sessions[session] ?? IDLE);

	useEffect(() => {
		if (session !== "") void host.composerData.ensure(session);
	}, [host, session, entry.status]);

	const service = host.composerData;
	const refresh = useCallback(() => {
		if (session !== "") void service.refresh(session);
	}, [service, session]);

	return { status: entry.status, data: entry.data?.[key] as T | undefined, session, refresh };
}

/** Refresh when the session's newest entry matches, or when a run of it ends: the widget decides, not the host. */
export function useComposerRefresh(host: Host, session: string, refresh: () => void, when: (entry: SeqEntry["entry"]) => boolean): void {
	const tail = useStore(host.transcript.store, (state) => {
		const log = state.logs[session];
		return log === undefined || log.length === 0 ? null : (log[log.length - 1]?.entry ?? null);
	});
	const running = useStore(host.sessions.store, (state) => state.rows.find((row) => row.name === session)?.running ?? false);

	const seen = useRef<string | null>(null);
	useEffect(() => {
		if (tail === null || seen.current === tail.id) return;
		const first = seen.current === null;
		seen.current = tail.id;
		if (first) return;
		if (when(tail)) refresh();
	}, [tail, refresh, when]);

	const wasRunning = useRef<boolean | null>(null);
	useEffect(() => {
		const last = wasRunning.current;
		wasRunning.current = running;
		if (last === null || last === running) return;
		if (!running) refresh();
	}, [running, refresh]);
}
