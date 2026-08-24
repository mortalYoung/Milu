import { createSignal } from "solid-js";

/**
 * Counter-backed busy signal: a boolean that flips true on the first `begin()` and only flips
 * false when every matching `end()` has run. Use for "is at least one async operation in flight?"
 * (e.g. a loading placeholder) when operations can overlap — a bare boolean would be cleared by
 * whichever operation finishes first, long before the last one settles.
 *
 * Manual begin/end (not an auto-wrapping run) so callers can hold the busy state across a
 * promise chain that itself starts another guarded operation.
 */
export function createInFlightBoolean() {
	const [loading, setLoading] = createSignal(false);
	let count = 0;
	const begin = () => {
		count++;
		setLoading(true);
	};
	const end = () => {
		// Clamp at 0 so a stray extra end() can never wedge the flag on forever.
		count = Math.max(0, count - 1);
		if (count === 0) setLoading(false);
	};
	return { loading, begin, end };
}
