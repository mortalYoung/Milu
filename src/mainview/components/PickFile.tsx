import { useState } from "react";
import { rpc } from "../lib/rpc";
import { cn } from "../lib/utils";
import { TextField, TextFieldInput } from "./ui/text-field";

export function PickFile(props: {
	value: string;
	placeholder?: string;
	variant?: "default" | "compact";
	class?: string;
	title?: string;
	ariaLabel?: string;
	onPick: (path: string) => void;
}) {
	const [busy, setBusy] = useState(false);

	const pick = async () => {
		if (busy) return;
		setBusy(true);
		try {
			const res = await rpc.request.pick_directory({ startingFolder: props.value.trim() || undefined });
			if (res.path) props.onPick(res.path);
		} catch {
			// dialog cancelled or unavailable — keep the current value
		} finally {
			setBusy(false);
		}
	};

	return (
		<TextField className={props.class}>
			<TextFieldInput
				variant={props.variant ?? "compact"}
				value={props.value}
				readOnly
				placeholder={props.placeholder ?? "Choose a directory…"}
				aria-label={props.ariaLabel ?? props.title ?? "Choose a directory"}
				onClick={() => void pick()}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						void pick();
					}
				}}
				className={cn("cursor-pointer select-none truncate", busy && "opacity-60")}
				spellCheck={false}
			/>
		</TextField>
	);
}
