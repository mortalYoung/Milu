import { createContext, type ReactNode, useContext } from "react";
import type { createComposer } from "../composer";

export type Composer = ReturnType<typeof createComposer>;

const ComposerContext = createContext<Composer | undefined>(undefined);

export function ComposerProvider(props: { value: Composer; children?: ReactNode }) {
	return <ComposerContext.Provider value={props.value}>{props.children}</ComposerContext.Provider>;
}

export function useComposer(): Composer {
	const ctx = useContext(ComposerContext);
	if (!ctx) throw new Error("useComposer must be used within ComposerProvider");
	return ctx;
}
