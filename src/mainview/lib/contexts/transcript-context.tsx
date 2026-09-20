import { createContext, type ReactNode, useContext } from "react";
import type { createTranscript } from "../transcript";

export type Transcript = ReturnType<typeof createTranscript>;

const TranscriptContext = createContext<Transcript | undefined>(undefined);

export function TranscriptProvider(props: { value: Transcript; children?: ReactNode }) {
	return <TranscriptContext.Provider value={props.value}>{props.children}</TranscriptContext.Provider>;
}

export function useTranscript(): Transcript {
	const ctx = useContext(TranscriptContext);
	if (!ctx) throw new Error("useTranscript must be used within TranscriptProvider");
	return ctx;
}
