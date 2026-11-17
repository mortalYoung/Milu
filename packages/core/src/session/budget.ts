export interface CompactionPolicy {
	readonly thresholdRatio: number;
	readonly headroomTokens: number;
	readonly retainRatio: number;
	readonly retainTokens?: number;
}

export interface CompactionModelPolicy {
	readonly provider: string;
	readonly model?: string;
	readonly thresholdRatio?: number;
	readonly headroomTokens?: number;
	readonly retainRatio?: number;
	readonly retainTokens?: number;
}

export interface CompactionSettings {
	readonly thresholdRatio?: number;
	readonly headroomTokens?: number;
	readonly retainRatio?: number;
	readonly retainTokens?: number;
	readonly maxOverflowRetries?: number;
	readonly modelPolicies?: readonly CompactionModelPolicy[];
}

export interface CompactionBudget {
	readonly threshold: number;
	readonly retainTokens: number;
}

export const DEFAULT_THRESHOLD_RATIO = 0.8;
export const DEFAULT_HEADROOM_TOKENS = 65_536;
export const DEFAULT_RETAIN_RATIO = 0.16;

export function compactionPolicy(settings: CompactionSettings | undefined, target: { readonly provider: string; readonly model?: string }): CompactionPolicy {
	const base: CompactionPolicy = {
		thresholdRatio: settings?.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO,
		headroomTokens: settings?.headroomTokens ?? DEFAULT_HEADROOM_TOKENS,
		retainRatio: settings?.retainRatio ?? DEFAULT_RETAIN_RATIO,
		...(settings?.retainTokens === undefined ? {} : { retainTokens: settings.retainTokens }),
	};
	return (settings?.modelPolicies ?? [])
		.filter((policy) => policy.provider === target.provider && (policy.model === undefined || policy.model === target.model))
		.reduce<CompactionPolicy>(
			(merged, policy) => ({
				thresholdRatio: policy.thresholdRatio ?? merged.thresholdRatio,
				headroomTokens: policy.headroomTokens ?? merged.headroomTokens,
				retainRatio: policy.retainRatio ?? merged.retainRatio,
				...(policy.retainTokens !== undefined ? { retainTokens: policy.retainTokens } : merged.retainTokens === undefined ? {} : { retainTokens: merged.retainTokens }),
			}),
			base,
		);
}

export function compactionBudget(input: { readonly contextWindow: number; readonly outputReserve: number; readonly policy: CompactionPolicy }): CompactionBudget {
	const usable = input.contextWindow - input.outputReserve;
	if (!(usable > 0)) {
		throw new Error(
			`compaction cannot run: the model reserves ${input.outputReserve} output tokens out of a ${input.contextWindow}-token window — lower the model's maxTokens or pick a larger-context model`,
		);
	}
	const threshold = Math.floor(Math.min(input.contextWindow * input.policy.thresholdRatio, usable - input.policy.headroomTokens));
	if (!(threshold > 0)) {
		throw new Error(
			`compaction cannot run: ${input.contextWindow} window − ${input.outputReserve} output − ${input.policy.headroomTokens} headroom leaves nothing to fill — lower compaction.headroomTokens or the model's maxTokens`,
		);
	}
	const retainTokens = input.policy.retainTokens ?? Math.floor(usable * input.policy.retainRatio);
	if (retainTokens >= threshold) {
		throw new Error(
			`compaction cannot run: retaining ${retainTokens} tokens of tail is not below the ${threshold}-token threshold — lower compaction.retainRatio (or retainTokens) below ${input.policy.thresholdRatio}`,
		);
	}
	return { threshold, retainTokens };
}
