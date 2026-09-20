import { createStore } from "zustand/vanilla";

export function createInFlightBoolean() {
	const store = createStore<{ loading: boolean }>()(() => ({ loading: false }));
	let count = 0;

	const begin = () => {
		count++;
		store.setState({ loading: true });
	};
	const end = () => {
		count = Math.max(0, count - 1);
		if (count === 0) store.setState({ loading: false });
	};

	return { store, begin, end };
}
