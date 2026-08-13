/**
 * Transcript — the document layer, rendered with Solid.
 * Knows nothing about RPC or the agent: it receives entries and renders them.
 * IM layout: user bubbles right with avatar, agent bubbles left with avatar;
 * the working indicator is the "typing" bubble while the agent runs its
 * (invisible) inner loop.
 */
import { Bot, User } from "lucide-solid";
import { type Accessor, createEffect, For } from "solid-js";

export interface Entry {
	id: number;
	kind: "user" | "agent" | "sys" | "sep";
	text: string;
	time?: string;
	error?: boolean;
}

export const SEPARATOR_GAP_MS = 5 * 60 * 1000;

let nextId = 1;
const pad = (n: number) => String(n).padStart(2, "0");
export const fmtTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function makeUserEntry(text: string, time = Date.now()): Entry {
	return { id: nextId++, kind: "user", text, time: fmtTime(new Date(time)) };
}

export function makeAgentEntry(text: string, time = Date.now()): Entry {
	return { id: nextId++, kind: "agent", text, time: fmtTime(new Date(time)) };
}

export function makeSysEntry(text: string, error = false): Entry {
	return { id: nextId++, kind: "sys", text, error };
}

export function makeSepEntry(text: string): Entry {
	return { id: nextId++, kind: "sep", text };
}

export function Transcript(props: { entries: Accessor<Entry[]>; working: Accessor<boolean>; tick: Accessor<number> }) {
	let container: HTMLElement | undefined;

	createEffect(() => {
		props.tick(); // push、history、turn、end — 都 bump
		container && (container.scrollTop = container.scrollHeight);
	});

	return (
		<section class="transcript flex-1 overflow-y-auto overscroll-contain px-4 py-3" id="transcript" aria-live="polite" ref={container}>
			{props.entries().length === 0 && !props.working() && (
				<div class="empty-state text-center font-serif italic text-[14px] text-ink-soft pt-16">
					<p>— waiting for your first prompt —</p>
					<p class="mt-2">ask it to read a file, run a command, or just talk</p>
				</div>
			)}
			<For each={props.entries()}>
				{(e) => {
					if (e.kind === "user") {
						return (
							<div class="msg msg-user">
								<span class="msg-avatar avatar-user">
									<User size={16} />
								</span>
								<div class="msg-col">
									<div class="msg-bubble">{e.text}</div>
									<div class="msg-meta">{e.time}</div>
								</div>
							</div>
						);
					}
					if (e.kind === "agent") {
						return (
							<div class="msg msg-agent">
								<span class="msg-avatar avatar-agent">
									<Bot size={16} />
								</span>
								<div class="msg-col">
									<div class="msg-bubble">{e.text}</div>
									<div class="msg-meta">{e.time}</div>
								</div>
							</div>
						);
					}
					if (e.kind === "sys") {
						return <div class={e.error ? "sys sys-error" : "sys"}>{e.text}</div>;
					}
					return <div class="time-sep">{e.text}</div>;
				}}
			</For>
			{props.working() && (
				<div class="msg msg-agent">
					<span class="msg-avatar avatar-agent">
						<Bot size={16} />
					</span>
					<div class="msg-col">
						<div class="msg-bubble">
							<span class="cursor" />
						</div>
					</div>
				</div>
			)}
		</section>
	);
}
