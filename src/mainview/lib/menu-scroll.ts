import { useEffect } from "react";

/**
 * Keep the highlighted row inside the panel's own scroll box — the same move the palette makes
 * (`scrollIntoView({ block: "nearest" })`), so the two composer menus follow the palette's
 * behaviour rather than inventing a second one. `nearest` leaves the ancestors alone when the row is
 * already visible.
 */
export function useRowInView(prefix: string, selectedIndex: number): void {
	useEffect(() => {
		requestAnimationFrame(() => document.getElementById(`${prefix}-${selectedIndex}`)?.scrollIntoView({ block: "nearest" }));
	}, [prefix, selectedIndex]);
}
