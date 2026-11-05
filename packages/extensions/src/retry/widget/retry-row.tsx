import type { SlotProps, ViewItem } from "@milu/window/api";

function seconds(ms: number): string {
	if (ms <= 0) return "now";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}

export function RetryRow(props: SlotProps) {
	const item = (props.data as { item?: ViewItem } | undefined)?.item;
	const retry = item?.retry;
	if (retry === undefined) return null;
	return (
		<div className={`msg-retry${retry.started === true ? " is-running" : ""}`} data-entry={item?.id}>
			<span className="msg-retry-tag">{retry.started === true ? "RETRIED" : "RETRY"}</span>
			<span className="msg-retry-count">
				{retry.attempt}/{retry.maxRetries}
			</span>
			{retry.started === true ? null : <span className="msg-retry-wait">in {seconds(retry.delayMs)}</span>}
			{retry.error === "" ? null : <span className="msg-retry-error">{retry.error}</span>}
		</div>
	);
}
