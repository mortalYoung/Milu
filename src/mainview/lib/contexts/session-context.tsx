import { createContext, type JSX, useContext } from "solid-js";
import type { createSession } from "../session";

export type Session = ReturnType<typeof createSession>;

const SessionContext = createContext<Session | undefined>(undefined);

export function SessionProvider(props: { value: Session; children?: JSX.Element }) {
	return <SessionContext.Provider value={props.value}>{props.children}</SessionContext.Provider>;
}

export function useSession(): Session {
	const ctx = useContext(SessionContext);
	if (!ctx) throw new Error("useSession must be used within SessionProvider");
	return ctx;
}
