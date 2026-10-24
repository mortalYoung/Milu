import { createContext, useContext, useSyncExternalStore } from "react";

export interface ExtensionWidgetProps {
	readonly id: string;
	readonly data: unknown;
}

export interface WidgetContextValue {
	readonly extension: string;
	readonly id: string;
	readonly data: unknown;
	readonly session: string | null;
	load(key: string): Promise<unknown>;
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
}

const cache = new Map<string, Record_>();

function publish(record: Record_, entry: Entry): void {
	record.entry = entry;
	for (const listener of record.listeners) listener();
}

function recordFor(key: string, load: () => Promise<unknown>): Record_ {
	const existing = cache.get(key);
	if (existing) return existing;

	const record: Record_ = { entry: { status: "loading" }, listeners: new Set() };
	cache.set(key, record);
	load().then(
		(data) => publish(record, { status: "ready", data }),
		(error: unknown) => publish(record, { status: "error", error: error instanceof Error ? error.message : String(error) }),
	);
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
	return useWidgetContext().session;
}

export function useCommand(): (command: string, ...args: unknown[]) => Promise<unknown> {
	return useWidgetContext().execute;
}

export function useExtensionData<T>(key: string): { readonly status: "loading" | "ready" | "error"; readonly data: T | undefined; readonly error?: string } {
	const value = useWidgetContext();
	const record = recordFor(`${value.extension}:${key}:${value.session ?? ""}`, () => value.load(key));
	const entry = useSyncExternalStore(
		(listener) => {
			record.listeners.add(listener);
			return () => record.listeners.delete(listener);
		},
		() => record.entry,
	);
	return { status: entry.status, data: entry.data as T | undefined, ...(entry.error === undefined ? {} : { error: entry.error }) };
}
