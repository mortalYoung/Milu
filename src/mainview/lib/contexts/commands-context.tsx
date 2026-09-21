import { createContext, type ReactNode, useContext } from "react";
import type { createCommandDirectory } from "../commands";

export type CommandDirectory = ReturnType<typeof createCommandDirectory>;

const CommandDirectoryContext = createContext<CommandDirectory | undefined>(undefined);

export function CommandDirectoryProvider(props: { value: CommandDirectory; children?: ReactNode }) {
	return <CommandDirectoryContext.Provider value={props.value}>{props.children}</CommandDirectoryContext.Provider>;
}

export function useCommandDirectory(): CommandDirectory {
	const ctx = useContext(CommandDirectoryContext);
	if (!ctx) throw new Error("useCommandDirectory must be used within CommandDirectoryProvider");
	return ctx;
}
