/**
 * Transcript — the document layer, rendered with Solid.
 * Knows nothing about RPC or the agent: it receives entries and renders them.
 * Streaming agent text lives in a per-entry signal, so a delta patches only
 * that text node — no list re-render (this is why Solid suits the double loop).
 */
import { For, createEffect, createSignal, type Accessor } from "solid-js";

export type Entry =
	| { id: number; kind: "user"; text: string; time: string }
	| {
			id: number;
			kind: "agent";
			text: Accessor<string>;
			setText: (t: string | ((prev: string) => string)) => void;
			time: string;
	  }
	| {
			id: number;
			kind: "sys";
			text: Accessor<string>;
			setText: (t: string | ((prev: string) => string)) => void;
			error: boolean;
	  }
	| { id: number; kind: "sep"; text: string };

export const SEPARATOR_GAP_MS = 5 * 60 * 1000;

let nextId = 1;
const pad = (n: number) => String(n).padStart(2, "0");
export const fmtTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function makeUserEntry(text: string): Entry {
	return { id: nextId++, kind: "user", text, time: fmtTime(new Date()) };
}

export function makeAgentEntry(): Entry {
	const [text, setText] = createSignal("");
	return { id: nextId++, kind: "agent", text, setText, time: fmtTime(new Date()) };
}

export function makeSysEntry(text: string, error = false): Entry {
	const [value, setValue] = createSignal(text);
	return { id: nextId++, kind: "sys", text: value, setText: setValue, error };
}

export function makeSepEntry(text: string): Entry {
	return { id: nextId++, kind: "sep", text };
}

export function Transcript(props: { entries: Accessor<Entry[]>; streamingId: Accessor<number | null>; tick: Accessor<number> }) {
	let container: HTMLElement | undefined;

	createEffect(() => {
		props.tick(); // push, delta, tool update, finish — all bump it
		container && (container.scrollTop = container.scrollHeight);
	});

	return (
		<section class="transcript flex-1 overflow-y-auto overscroll-contain px-4 py-3" id="transcript" aria-live="polite" ref={container}>
			{props.entries().length === 0 && (
				<div class="empty-state text-center font-serif italic text-[14px] text-ink-soft pt-16">
					<p>— waiting for your first prompt —</p>
					<p class="mt-2">ask it to read a file, run a command, or just talk</p>
				</div>
			)}
			{/* keyed by item identity: only newly pushed entries build components;
			    a streaming agent entry updates its own text signal in place */}
			<For each={props.entries()}>
				{(e) => {
					if (e.kind === "user") {
						return (
							<div class="msg msg-user">
								<div class="msg-bubble">{e.text}</div>
								<div class="msg-meta">{e.time}</div>
							</div>
						);
					}
					if (e.kind === "agent") {
						return (
							<div class="msg msg-agent">
								<div class="msg-bubble">
									{e.text()}
									{e.id === props.streamingId() && <span class="cursor" />}
								</div>
								<div class="msg-meta">{e.time}</div>
							</div>
						);
					}
					if (e.kind === "sys") {
						return <div class={e.error ? "sys sys-error" : "sys"}>{e.text()}</div>;
					}
					return <div class="time-sep">{e.text}</div>;
				}}
			</For>
		</section>
	);
}
