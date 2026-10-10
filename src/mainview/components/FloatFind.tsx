import { ChevronDown, ChevronUp, X } from "lucide-react";
import { motion } from "motion/react";
import { useRef } from "react";
import type { FloatFindProps } from "../lib/find";
import { imeGuard } from "../lib/ime";

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
				<span className={"float-find-count" + (searching && !found ? " empty" : "")} aria-live="polite" title={props.hint} aria-hidden={count === ""}>
					{count}
				</span>
			</span>
			<button
				type="button"
				className="float-find-nav"
				title="Previous match (Shift+Enter)"
				aria-label="Previous match"
				disabled={!found}
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => props.onStep(-1)}
			>
				<ChevronUp size={14} />
			</button>
			<button
				type="button"
				className="float-find-nav"
				title="Next match (Enter)"
				aria-label="Next match"
				disabled={!found}
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => props.onStep(1)}
			>
				<ChevronDown size={14} />
			</button>
			<span className="float-find-divider" />
			<button type="button" className="float-find-close" title="Close (Esc)" aria-label="Close find" onClick={props.onClose}>
				<X size={14} />
			</button>
		</motion.div>
	);
}
