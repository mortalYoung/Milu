export function Skeleton(props: { width?: number | string; height?: number; className?: string }) {
	return (
		<span
			className={`inline-block animate-[skeleton-pulse_1.4s_ease-in-out_infinite] rounded-[4px] bg-[color-mix(in_srgb,var(--line)_45%,transparent)] align-middle motion-reduce:animate-none ${props.className ?? ""}`}
			style={{ width: props.width, height: props.height }}
			aria-hidden="true"
		/>
	);
}

export function LoadingLines(props: { rows?: number }) {
	return (
		<span className="flex flex-col gap-2 px-0 py-1" aria-busy="true">
			{Array.from({ length: props.rows ?? 3 }, (_, index) => (
				<Skeleton key={index} height={11} width={index === 0 ? "72%" : index === 1 ? "88%" : "54%"} />
			))}
		</span>
	);
}
