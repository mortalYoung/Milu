import { ChevronDown, ChevronUp, X } from "lucide-react";
import { motion } from "motion/react";
import { useRef } from "react";
import type { FloatFindProps } from "../lib/find";
import { imeGuard } from "../lib/ime";
import { Tip } from "./ui/tooltip";

export function FloatFind(props: FloatFindProps) {
	const { query, result } = props;
	const searching = query !== "";
	const found = result.count > 0;
	const count = searching ? (found ? `${result.active + 1}/${result.count}` : "0/0") : "";
	const latest = useRef(props);
	latest.current = props;
	const imeRef = useRef<ReturnType<typeof imeGuard> | null>(null);
	if (!imeRef.current) imeRef.current = imeGuard((value) => latest.current.onQuery(value));
	const ime = imeRef.current;

	const countChip = (
		<span className={"float-find-count" + (searching && !found ? " empty" : "")} aria-live="polite" aria-hidden={count === ""}>
			{count}
		</span>
	);

	return (
		<motion.div
			className="float-find"
			role="search"
			aria-label="Find"
			initial={{ opacity: 0, scale: 0.98, y: -6 }}
			animate={{ opacity: 1, scale: 1, y: 0 }}
			exit={{ opacity: 0, scale: 0.99, y: -3, transition: { duration: 0.1 } }}
			transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
		>
			<span className="float-find-field">
				<input
					ref={props.inputRef}
					className={"float-find-input" + (result.valid ? "" : " invalid")}
					placeholder="Find"
					aria-label="Find"
					autoComplete="off"
					autoCapitalize="off"
					spellCheck={false}
					value={query}
					onChange={(event) => props.onQuery(event.currentTarget.value)}
					onKeyDown={(event) => {
						const native = event.nativeEvent;
						ime.onKeyDown(native);
						if (native.isComposing || ime.composing) return;
						props.onInputKeyDown(event);
					}}
					onCompositionStart={ime.onStart}
					onCompositionEnd={(event) => ime.onEnd(event.nativeEvent, event.currentTarget)}
				/>
				{props.hint ? (
					<Tip label={props.hint} className="max-w-[260px] leading-snug">
						{countChip}
					</Tip>
				) : (
					countChip
				)}
			</span>
			<Tip label="Previous match (Shift+Enter)">
				<button
					type="button"
					className="float-find-nav"
					aria-label="Previous match"
					disabled={!found}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => props.onStep(-1)}
				>
					<ChevronUp size={14} />
				</button>
			</Tip>
			<Tip label="Next match (Enter)">
				<button type="button" className="float-find-nav" aria-label="Next match" disabled={!found} onMouseDown={(event) => event.preventDefault()} onClick={() => props.onStep(1)}>
					<ChevronDown size={14} />
				</button>
			</Tip>
			<span className="float-find-divider" />
			<Tip label="Close (Esc)">
				<button type="button" className="float-find-close" aria-label="Close find" onClick={props.onClose}>
					<X size={14} />
				</button>
			</Tip>
		</motion.div>
	);
}
