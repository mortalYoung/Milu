const SKELETON_ROWS = 5;

export function SessionListSkeleton() {
	return (
		<>
			{Array.from({ length: SKELETON_ROWS }, (_, index) => (
				<div className="flex items-center gap-2.5 px-2 py-[9px] pr-3" key={index} aria-busy="true">
					<span className="size-[34px] shrink-0 rounded-full bg-line/40" />
					<span className="flex flex-1 flex-col gap-[11px]">
						<span className="h-[13px] w-[52%] rounded bg-line/40" />
						<span className="h-[11px] w-[78%] rounded bg-line/40" />
					</span>
				</div>
			))}
		</>
	);
}

export function TranscriptSkeleton() {
	return (
		<div className="transcript-skeleton" aria-busy="true">
			<div className="skeleton-turn is-user">
				<span className="skeleton-line" />
			</div>
			<div className="skeleton-turn">
				<span className="skeleton-line" />
				<span className="skeleton-line short" />
				<span className="skeleton-line" />
			</div>
		</div>
	);
}
