import { React } from "./runtime.ts";
import { assetOf, CELL, COLUMNS, DURATION, FRAMES, type PetSheet, ROWS, rowOf, type SpriteState } from "./sheets.ts";

export function PetSprite(props: { sheet: PetSheet; state: SpriteState; size: number; frame?: number }) {
	const { sheet, state, size, frame } = props;
	const src = assetOf(sheet.file);
	const [failed, setFailed] = React.useState<string | null>(null);

	React.useEffect(() => {
		const probe = new Image();
		probe.onerror = () => setFailed(src);
		probe.src = src;
		return () => {
			probe.onerror = null;
		};
	}, [src]);

	if (failed !== null) return <div className="milu-ext-pet-failed">sprite failed: {failed}</div>;

	const height = Math.round((size * CELL.height) / CELL.width);
	const frames = FRAMES[state];
	const still = frame === undefined ? undefined : `${-frame * size}px`;
	return (
		<div
			role="img"
			aria-label={`${sheet.name} · ${state}`}
			className="milu-ext-pet-sprite"
			style={{
				width: size,
				height,
				backgroundImage: `url(${src})`,
				backgroundSize: `${COLUMNS * size}px ${ROWS * height}px`,
				backgroundPositionY: `${-rowOf(state) * height}px`,
				...(still === undefined ? {} : { backgroundPositionX: still, animation: "none" as const }),
				["--pet-frames" as string]: `${-frames * size}px`,
				["--pet-steps" as string]: `${frames}`,
				["--pet-duration" as string]: `${DURATION[state] ?? 1200}ms`,
			}}
		/>
	);
}
