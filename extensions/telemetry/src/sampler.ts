export interface TelemetrySample {
	readonly at: number;
	readonly fps: number;
	readonly frameMs: number;
	readonly frameP95: number;
	readonly jank: number;
	readonly longTasks: number;
	readonly longTaskMs: number;
	readonly lagMs: number;
	readonly heapUsed: number;
	readonly heapLimit: number;
	readonly nodes: number;
}

export interface Sampler {
	start(): void;
	stop(): void;
	reset(): void;
}

const BUCKET_MS = 1000;
const TICK_MS = 250;
const JANK_MS = 50;
const MAX_FRAME_MS = 1000;

export function createSampler(onSample: (sample: TelemetrySample) => void): Sampler {
	let running = false;
	let frameRequest = 0;
	let tickTimer = 0;
	let observer: PerformanceObserver | null = null;
	let lastFrame = 0;
	let bucketStart = 0;
	let frameCount = 0;
	let frameTotal = 0;
	let jank = 0;
	let frameTimes: number[] = [];
	let longTasks = 0;
	let longTaskMs = 0;
	let lagMs = 0;
	let expectedTick = 0;

	const memory = (): { used: number; limit: number } => {
		const value = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
		return { used: value?.usedJSHeapSize ?? 0, limit: value?.jsHeapSizeLimit ?? 0 };
	};

	const resetBucket = (now: number): void => {
		lastFrame = now;
		bucketStart = now;
		expectedTick = now + TICK_MS;
		frameCount = 0;
		frameTotal = 0;
		jank = 0;
		frameTimes = [];
		longTasks = 0;
		longTaskMs = 0;
	};

	const flush = (now: number): void => {
		const elapsed = Math.max(1, now - bucketStart);
		const sorted = frameTimes.length === 0 ? [0] : [...frameTimes].sort((left, right) => left - right);
		const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
		const heap = memory();
		onSample({
			at: Date.now(),
			fps: frameCount === 0 ? 0 : Math.round((frameCount * 1000) / elapsed),
			frameMs: frameCount === 0 ? 0 : frameTotal / frameCount,
			frameP95: p95,
			jank,
			longTasks,
			longTaskMs,
			lagMs,
			heapUsed: heap.used,
			heapLimit: heap.limit,
			nodes: document.getElementsByTagName("*").length,
		});
		resetBucket(now);
	};

	const frame = (now: number): void => {
		if (!running) return;
		const delta = now - lastFrame;
		lastFrame = now;
		if (delta > 0 && delta < MAX_FRAME_MS) {
			frameCount += 1;
			frameTotal += delta;
			frameTimes.push(delta);
			if (delta > JANK_MS) jank += 1;
		}
		if (now - bucketStart >= BUCKET_MS) flush(now);
		if (!running) return;
		frameRequest = requestAnimationFrame(frame);
	};

	const tick = (): void => {
		if (!running || document.hidden) return;
		const now = performance.now();
		lagMs = Math.max(0, Math.round(now - expectedTick));
		expectedTick = now + TICK_MS;
	};

	const onVisibility = (): void => {
		if (!document.hidden) resetBucket(performance.now());
	};

	const start = (): void => {
		if (running) return;
		running = true;
		resetBucket(performance.now());
		frameRequest = requestAnimationFrame(frame);
		tickTimer = window.setInterval(tick, TICK_MS);
		document.addEventListener("visibilitychange", onVisibility);
		try {
			observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					longTasks += 1;
					longTaskMs += entry.duration;
				}
			});
			observer.observe({ entryTypes: ["longtask"] });
		} catch {
			observer = null;
		}
	};

	const stop = (): void => {
		if (!running) return;
		running = false;
		cancelAnimationFrame(frameRequest);
		window.clearInterval(tickTimer);
		document.removeEventListener("visibilitychange", onVisibility);
		observer?.disconnect();
		observer = null;
	};

	const reset = (): void => {
		lagMs = 0;
		resetBucket(performance.now());
	};

	return { start, stop, reset };
}
