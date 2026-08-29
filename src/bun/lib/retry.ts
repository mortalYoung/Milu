import type { RetryPolicy } from "@earendil-works/pi-ai";
import type { Settings } from "./settings";

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 500;

export function resolveRetryPolicy(settings?: Settings): RetryPolicy {
	const maxRetries = settings?.retry?.maxRetries ?? DEFAULT_MAX_RETRIES;
	const baseDelayMs = settings?.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
	return { enabled: maxRetries !== 0, maxRetries, baseDelayMs };
}

let retrySeq = 0;

export function newRetryId(): string {
	return `retry-${Date.now().toString(36)}-${++retrySeq}`;
}
