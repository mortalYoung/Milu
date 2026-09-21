import { createContext, type ReactNode, useContext } from "react";
import type { createInbox } from "../inbox";

export type Inbox = ReturnType<typeof createInbox>;

const InboxContext = createContext<Inbox | undefined>(undefined);

export function InboxProvider(props: { value: Inbox; children?: ReactNode }) {
	return <InboxContext.Provider value={props.value}>{props.children}</InboxContext.Provider>;
}

export function useInbox(): Inbox {
	const ctx = useContext(InboxContext);
	if (!ctx) throw new Error("useInbox must be used within InboxProvider");
	return ctx;
}
