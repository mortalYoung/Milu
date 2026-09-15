import { createContext, type JSX, useContext } from "solid-js";
import type { createInbox } from "../inbox";

export type Inbox = ReturnType<typeof createInbox>;

const InboxContext = createContext<Inbox | undefined>(undefined);

export function InboxProvider(props: { value: Inbox; children?: JSX.Element }) {
	return <InboxContext.Provider value={props.value}>{props.children}</InboxContext.Provider>;
}

export function useInbox(): Inbox {
	const ctx = useContext(InboxContext);
	if (!ctx) throw new Error("useInbox must be used within InboxProvider");
	return ctx;
}
