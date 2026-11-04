import { useEffect, useMemo, useState } from "react";

import { type MarkdownEnv, type MarkdownPort } from "./types.ts";

export interface MarkdownProps {
	readonly port: MarkdownPort;
	readonly text: string;
	readonly env?: MarkdownEnv;
	readonly className?: string;
	/** Start from the fast pass and catch up to the full one (shiki) once the text settles. */
	readonly plain?: boolean;
}

export function Markdown(props: MarkdownProps) {
	const { port, text, env, plain: late = false } = props;
	const fast = useMemo(() => port.render(text, env), [port, text, env]);
	const [full, setFull] = useState<{ text: string; html: string } | null>(null);

	useEffect(() => {
		let alive = true;
		const settle = () => {
			void port.renderFull(text, env).then((html) => {
				if (alive) setFull({ text, html });
			});
		};
		if (!late) {
			settle();
			return () => {
				alive = false;
			};
		}
		const timer = window.setTimeout(settle, 140);
		return () => {
			alive = false;
			window.clearTimeout(timer);
		};
	}, [port, text, env, late]);

	const html = full !== null && full.text === text ? full.html : fast;
	const className = `md${late ? " md-plain" : ""}${props.className ? ` ${props.className}` : ""}`;
	return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
