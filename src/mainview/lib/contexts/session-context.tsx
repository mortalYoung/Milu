import { createContext, type ReactNode, useContext } from "react";
import type { createSession } from "../session";

export type Session = ReturnType<typeof createSession>;

const SessionContext = createContext<Session | undefined>(undefined);

export function SessionProvider(props: { value: Session; children?: ReactNode }) {
	return <SessionContext.Provider value={props.value}>{props.children}</SessionContext.Provider>;
}

export function useSession(): Session {
	const ctx = useContext(SessionContext);
	if (!ctx) throw new Error("useSession must be used within SessionProvider");
	return ctx;
}
