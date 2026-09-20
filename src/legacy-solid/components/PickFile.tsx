import { createSignal } from "solid-js";
import { rpc } from "../lib/rpc";
import { cn } from "../lib/utils";
import { TextField, TextFieldInput } from "./ui/text-field";

/**
 * PickFile — a read-only path field that looks exactly like a TextFieldInput.
 * Clicking (or Enter/Space while focused) opens the system directory picker;
 * the chosen path is reported through onPick. The field itself is not editable.
 */
export function PickFile(props: {
	value: string;
	placeholder?: string;
	variant?: "default" | "compact";
	class?: string;
	title?: string;
	ariaLabel?: string;
	onPick: (path: string) => void;
}) {
	const [busy, setBusy] = createSignal(false);

	const pick = async () => {
		if (busy()) return;
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
		<TextField class={props.class}>
			<TextFieldInput
				variant={props.variant ?? "compact"}
				value={props.value}
				readOnly
				placeholder={props.placeholder ?? "Choose a directory…"}
				title={props.value || props.title || "Choose a directory…"}
				aria-label={props.ariaLabel ?? props.title ?? "Choose a directory"}
				onClick={() => void pick()}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						void pick();
					}
				}}
				class={cn("cursor-pointer select-none truncate", busy() && "opacity-60")}
				spellcheck={false}
			/>
		</TextField>
	);
}
