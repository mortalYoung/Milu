import type { DialogProps } from "@milu/window/api";
import { useState } from "react";

interface PreviewData {
	readonly src?: string;
	readonly alt?: string;
	readonly error?: string;
}

export function ImagePreview(props: DialogProps) {
	const data = (props.data ?? null) as PreviewData | null;
	const src = typeof data?.src === "string" ? data.src : "";
	const alt = typeof data?.alt === "string" ? data.alt : "";
	const [size, setSize] = useState("");

	if (src === "") {
		return <p className="m-0 px-4 py-3 font-mono text-[11px] text-signal">{data?.error ?? "no image to show"}</p>;
	}

	return (
		<figure className="m-0 flex max-w-[calc(100vw-96px)] flex-col">
			<div className="flex h-9 shrink-0 items-center gap-3 pr-12 pl-3">
				<span className="truncate font-mono text-[9.5px] tracking-[0.12em] text-muted uppercase">{alt === "" ? "image" : alt}</span>
				<span className="ml-auto shrink-0 font-mono text-[10px] text-muted-soft tabular-nums">{size}</span>
			</div>
			<img
				src={src}
				alt={alt}
				onLoad={(event) => setSize(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)}
				className="block max-h-[74vh] max-w-[calc(100vw-96px)] object-contain"
			/>
		</figure>
	);
}

export default ImagePreview;
