import { createContext, type JSX, useContext } from "solid-js";
import type { ScrollFollower } from "../scroll-follower";

const ScrollContext = createContext<ScrollFollower>();

export function ScrollProvider(props: { value: ScrollFollower; children?: JSX.Element }) {
	return <ScrollContext.Provider value={props.value}>{props.children}</ScrollContext.Provider>;
}

export function useScroll(): ScrollFollower {
	const ctx = useContext(ScrollContext);
	if (!ctx) throw new Error("useScroll must be used within ScrollProvider");
	return ctx;
}
