const SKELETON_ROWS = 6;

export function SessionListSkeleton() {
	return (
		<>
			{Array.from({ length: SKELETON_ROWS }, (_, index) => (
				<div className="flex items-center gap-2 px-2 py-1.5" key={index} aria-busy="true">
					<span className="flex w-[10px] shrink-0 justify-center">
						<span className="size-[5px] rounded-full bg-line/40" />
					</span>
					<span className="flex min-w-0 flex-1 flex-col gap-[5px]">
						<span className="flex min-w-0 items-center gap-1.5">
							<span className="h-[12px] w-[40%] shrink-0 rounded bg-line/40" />
							<span className="h-[10px] w-[30%] min-w-0 rounded bg-line/40" />
						</span>
						<span className="h-[9px] w-[22%] rounded bg-line/40" />
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
