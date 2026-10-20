const SKELETON_ROWS = 5;

export function SessionListSkeleton() {
	return (
		<>
			{Array.from({ length: SKELETON_ROWS }, (_, index) => (
				<div className="conv-skeleton" key={index} aria-busy="true">
					<span className="conv-skeleton-face" />
					<span className="conv-skeleton-lines">
						<span className="conv-skeleton-line" />
						<span className="conv-skeleton-line preview" />
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
