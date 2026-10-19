import { type MarkdownEnv, type MarkdownPort } from "@milu/client";
import { useEffect, useMemo, useState } from "react";

export interface MarkdownProps {
	readonly port: MarkdownPort;
	readonly text: string;
	readonly env?: MarkdownEnv;
	readonly className?: string;
}

export function Markdown(props: MarkdownProps) {
	const { port, text, env } = props;
	const plain = useMemo(() => port.render(text, env), [port, text, env]);
	const [full, setFull] = useState<{ text: string; html: string } | null>(null);

	useEffect(() => {
		let alive = true;
		void port.renderFull(text, env).then((html) => {
			if (alive) setFull({ text, html });
		});
		return () => {
			alive = false;
		};
	}, [port, text, env]);

	const html = full !== null && full.text === text ? full.html : plain;
	return <div className={props.className ? `md ${props.className}` : "md"} dangerouslySetInnerHTML={{ __html: html }} />;
}
