import type { Host } from "@milu/window";
import type { MarkdownEnv } from "@milu/window/markdown";
import { useEffect, useMemo, useState } from "react";

const ANGLE_IMAGE = /!\[[^\]]*\]\(\s*<([^>]*)>/g;
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*(?!<)<?([^)\s>]+)>?/g;
const HTML_IMAGE = /<img\s[^>]*?src\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const MAX_IMAGES = 12;

const cache = new Map<string, string>();

function sourcesOf(text: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(ANGLE_IMAGE)) found.add(match[1] ?? "");
	for (const match of text.matchAll(MARKDOWN_IMAGE)) found.add(match[1] ?? "");
	for (const match of text.matchAll(HTML_IMAGE)) found.add(match[1] ?? match[2] ?? "");
	for (const src of found) if (src === "" || SCHEME.test(src)) found.delete(src);
	return [...found].slice(0, MAX_IMAGES);
}

export function useImageEnv(host: Host, session: string, text: string, files?: readonly string[]): MarkdownEnv | undefined {
	const local = useMemo(() => sourcesOf(text), [text]);
	const key = `${session}\u0000${local.join("\u0000")}`;
	const [resolved, setResolved] = useState<{ readonly key: string; readonly images: ReadonlyMap<string, string> } | null>(null);

	const cached = useMemo(() => {
		const images = new Map<string, string>();
		for (const src of local) {
			const hit = cache.get(`${session}\u0000${src}`);
			if (hit !== undefined) images.set(src, hit);
		}
		return images;
	}, [local, session]);

	useEffect(() => {
		if (local.length === 0) return;
		const missing = local.filter((src) => !cached.has(src));
		if (missing.length === 0) return;
		let alive = true;
		void Promise.all(
			missing.map(async (src) => {
				try {
					const answer = await host.actions.request<{ dataUrl?: string }>("image.resolve", session, { path: src });
					if (answer?.dataUrl !== undefined) cache.set(`${session}\u0000${src}`, answer.dataUrl);
				} catch {
					return;
				}
			}),
		).then(() => {
			if (!alive) return;
			const images = new Map<string, string>();
			for (const src of local) {
				const hit = cache.get(`${session}\u0000${src}`);
				if (hit !== undefined) images.set(src, hit);
			}
			if (images.size > 0) setResolved({ key, images });
		});
		return () => {
			alive = false;
		};
	}, [host, session, local, key, cached]);

	const images = resolved !== null && resolved.key === key ? resolved.images : cached.size > 0 ? cached : null;

	return useMemo(() => {
		if (files === undefined && images === null) return undefined;
		return { ...(files === undefined ? {} : { files }), ...(images === null ? {} : { images }) };
	}, [files, images]);
}
