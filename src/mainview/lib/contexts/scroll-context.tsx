import { createContext, type ReactNode, useContext } from "react";
import type { ScrollFollower } from "../scroll-follower";

const ScrollContext = createContext<ScrollFollower | undefined>(undefined);

export function ScrollProvider(props: { value: ScrollFollower; children?: ReactNode }) {
	return <ScrollContext.Provider value={props.value}>{props.children}</ScrollContext.Provider>;
}

export function useScroll(): ScrollFollower {
	const ctx = useContext(ScrollContext);
	if (!ctx) throw new Error("useScroll must be used within ScrollProvider");
	return ctx;
}
