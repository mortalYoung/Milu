import { type Extension, IHookService, isRetryableAssistantError } from "@milu/core";

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 500;

/** `settings.json` may set either field; anything it leaves out comes from the defaults. */
interface RetryPolicy {
	readonly maxRetries: number;
	readonly baseDelayMs: number;
}

const retryExtension: Extension = {
	id: "retry",
	apiVersion: 1,

	widgets: [{ id: "retry", type: "row", entry: "./widget/retry-row.tsx", export: "RetryRow" }],

	activate(context) {
		const policy = context.disposables.add(
			context.settings.declare<RetryPolicy>({ key: "retry", defaults: { maxRetries: DEFAULT_MAX_RETRIES, baseDelayMs: DEFAULT_BASE_DELAY_MS } }),
		);
		const hooks = context.get(IHookService);
		/* The policy is ours; the loop only knows how to retry. Anything outside the classifier's list
		   (quota, billing, a broken request) fails at once instead of spending the budget. */
		context.disposables.add(
			hooks.onFailure((failure, retry) => {
				const { maxRetries, baseDelayMs } = policy.get();
				if (!(maxRetries > 0) || failure.attempt > maxRetries) return;
				if (!isRetryableAssistantError(failure.message)) return;
				retry({ delayMs: Math.max(0, baseDelayMs) * 2 ** (failure.attempt - 1), maxRetries });
			}),
		);
	},
};

export default retryExtension;
