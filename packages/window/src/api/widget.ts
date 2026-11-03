import { createContext, useContext, useSyncExternalStore } from "react";

export interface ExtensionWidgetProps {
	readonly id: string;
	readonly data: unknown;
}

export interface WidgetContextValue {
	readonly extension: string;
	readonly id: string;
	readonly data: unknown;
	getSession(): string | null;
	watchSession(listener: () => void): () => void;
	load(key: string, session: string | null): Promise<unknown>;
	execute(command: string, ...args: unknown[]): Promise<unknown>;
}

interface Entry {
	readonly status: "loading" | "ready" | "error";
	readonly data?: unknown;
	readonly error?: string;
}

interface Record_ {
	entry: Entry;
	readonly listeners: Set<() => void>;
	reload(): void;
}

const cache = new Map<string, Record_>();

function publish(record: Record_, entry: Entry): void {
	record.entry = entry;
	for (const listener of record.listeners) listener();
}

function recordFor(key: string, load: () => Promise<unknown>): Record_ {
	const existing = cache.get(key);
	if (existing) return existing;

	const record: Record_ = {
		entry: { status: "loading" },
		listeners: new Set(),
		reload: () => {
			publish(record, { status: "loading" });
			load().then(
				(data) => publish(record, { status: "ready", data }),
				(error: unknown) => publish(record, { status: "error", error: error instanceof Error ? error.message : String(error) }),
			);
		},
	};
	cache.set(key, record);
	record.reload();
	return record;
}

export const WidgetContext = createContext<WidgetContextValue | null>(null);

function useWidgetContext(): WidgetContextValue {
	const value = useContext(WidgetContext);
	if (value === null) throw new Error("widget hooks can only be used inside an extension widget");
	return value;
}

export function useWidget(): { readonly id: string; readonly data: unknown } {
	const value = useWidgetContext();
	return { id: value.id, data: value.data };
}

export function useSession(): string | null {
	const value = useWidgetContext();
	return useSyncExternalStore(value.watchSession, value.getSession);
}

export function useCommand(): (command: string, ...args: unknown[]) => Promise<unknown> {
	return useWidgetContext().execute;
}

export function useExtensionData<T>(key: string): {
	readonly status: "loading" | "ready" | "error";
	readonly data: T | undefined;
	readonly error?: string;
	/** Ask the extension for the value again — a widget whose number goes stale on a clock uses this. */
	refresh(): void;
} {
	const value = useWidgetContext();
	const session = useSession();
	const record = recordFor(`${value.extension}:${key}:${session ?? ""}`, () => value.load(key, session));
	const entry = useSyncExternalStore(
		(listener) => {
			record.listeners.add(listener);
			return () => record.listeners.delete(listener);
		},
		() => record.entry,
	);
	return { status: entry.status, data: entry.data as T | undefined, ...(entry.error === undefined ? {} : { error: entry.error }), refresh: record.reload };
}
