import { createContext, type JSX, useContext } from "solid-js";
import type { createSettings } from "../settings";

export type Settings = ReturnType<typeof createSettings>;

const SettingsContext = createContext<Settings | undefined>(undefined);

export function SettingsProvider(props: { value: Settings; children?: JSX.Element }) {
	return <SettingsContext.Provider value={props.value}>{props.children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
	const ctx = useContext(SettingsContext);
	if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
	return ctx;
}
