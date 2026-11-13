export interface Deadline {
	readonly signal: AbortSignal;
	readonly timedOut: () => boolean;
	readonly cancel: () => void;
}

export function startDeadline(parent: AbortSignal | undefined, ms: number): Deadline {
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, ms);
	const forward = () => controller.abort();
	parent?.addEventListener("abort", forward, { once: true });
	return {
		signal: controller.signal,
		timedOut: () => timedOut,
		cancel: () => {
			clearTimeout(timer);
			parent?.removeEventListener("abort", forward);
		},
	};
}
