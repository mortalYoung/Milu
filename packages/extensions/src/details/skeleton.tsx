export function Skeleton(props: { width?: number | string; height?: number; className?: string }) {
	return <span className={props.className ? `ext-skeleton ${props.className}` : "ext-skeleton"} style={{ width: props.width, height: props.height }} aria-hidden="true" />;
}

export function LoadingLines(props: { rows?: number }) {
	return (
		<span className="ext-loading-lines" aria-busy="true">
			{Array.from({ length: props.rows ?? 3 }, (_, index) => (
				<Skeleton key={index} height={11} width={index === 0 ? "72%" : index === 1 ? "88%" : "54%"} />
			))}
		</span>
	);
}
