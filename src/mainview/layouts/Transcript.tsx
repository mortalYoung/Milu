/**
 * Transcript — the document layer, rendered with Solid.
 * Knows nothing about RPC or the agent: it receives entries and renders them.
 * 书信对话:60% 居中信件窄栏,无头像。user = 暖墨信封气泡 + seal 时间;
 * agent = 信笺 + 虚线邮戳 + 内联代码 chip + 署名行;运行指示 = 末尾"正在说话"
 * 信笺气泡(三墨点 + 署名行),工作中新到的消息渲染在其上方。
 */
import { type Accessor, createEffect, For, type JSX } from "solid-js";
import { AnimatePresence, Motion, MotionConfigProvider } from "solid-motion";

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
/** 完整日期时间格式:2026-08-13 10:22:27 */
const fmtDateTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export function makeUserEntry(text: string, time = Date.now()): Entry {
	return { id: nextId++, kind: "user", text, time: fmtDateTime(new Date(time)) };
}

export function makeAgentEntry(text: string, time = Date.now()): Entry {
	return { id: nextId++, kind: "agent", text, time: fmtDateTime(new Date(time)) };
}

export function makeSysEntry(text: string, error = false): Entry {
	return { id: nextId++, kind: "sys", text, error };
}

export function makeSepEntry(text: string): Entry {
	return { id: nextId++, kind: "sep", text };
}

/** 解析 "2026-08-13 10:22:27" → 邮戳 "OCT 13" / "10:22" */
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function parseStamp(raw: string | undefined): { date: string; time: string } | null {
	const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
	if (!m) return null;
	return { date: `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`, time: `${m[4]}:${m[5]}` };
}

/** 12 小时制:10:22:27 → "10:22 AM" */
function time12(raw: string | undefined): string {
	const m = raw?.match(/ (\d{2}):(\d{2}):/);
	if (!m) return "";
	const h = Number(m[1]);
	const ampm = h >= 12 ? "PM" : "AM";
	return `${pad(h % 12 || 12)}:${m[2]} ${ampm}`;
}

/** 反引号代码片段 → inline-code chip(其余为纯文本) */
function renderRich(text: string): JSX.Element {
	const parts = text.split(/`([^`]+)`/g);
	return <>{parts.map((p, i) => (i % 2 === 1 ? <span class="inline-code">{p}</span> : <>{p}</>))}</>;
}

export function Transcript(props: { entries: Accessor<Entry[]>; working: Accessor<boolean>; tick: Accessor<number>; worker?: string }) {
	let container: HTMLElement | undefined;

	createEffect(() => {
		props.tick(); // push、history、turn、end — 都 bump
		container && (container.scrollTop = container.scrollHeight);
	});

	return (
		<MotionConfigProvider reducedMotion="user">
			<section class="transcript flex-1 overflow-y-auto overscroll-contain px-4 py-3" id="transcript" aria-live="polite" ref={container}>
				<div class="transcript-inner">
					{props.entries().length === 0 && !props.working() && (
						<div class="text-center pt-16">
							<p class="font-serif text-[17px] text-ink-soft">— waiting for your first prompt —</p>
							<p class="eyebrow mt-3">ask it to read a file, run a command, or just talk</p>
						</div>
					)}
					<For each={props.entries()}>
						{(e) => {
							if (e.kind === "user") {
								return (
									<>
										<Motion as="div" class="msg-user" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}>
											{e.text}
										</Motion>
										<span class="msg-user-time">{time12(e.time)}</span>
									</>
								);
							}
							if (e.kind === "agent") {
								const stamp = parseStamp(e.time);
								return (
									<Motion
										as="div"
										class="msg-letter"
										initial={{ opacity: 0, scale: 0.96, rotate: 0.4 }}
										animate={{ opacity: 1, scale: 1, rotate: 0 }}
										transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
									>
										{stamp && (
											<div class="msg-postmark">
												<span>{stamp.date}</span>
												<span>{stamp.time}</span>
											</div>
										)}
										<p class="msg-letter-text">{renderRich(e.text)}</p>
										{props.worker && (
											<div class="msg-sign">
												— {props.worker} · {time12(e.time)}
											</div>
										)}
									</Motion>
								);
							}
							if (e.kind === "sys") {
								return <div class={e.error ? "sys sys-error" : "sys"}>{e.text}</div>;
							}
							return <div class="time-sep">{e.text}</div>;
						}}
					</For>
					{/* 正在说话:信笺气泡渲染在末尾;工作中新到的消息追加在 entries 里,自然出现在其上方 */}
					<AnimatePresence>
						{props.working() && (
							<Motion
								as="div"
								class="msg-letter msg-speaking"
								initial={{ opacity: 0, scale: 0.97 }}
								animate={{ opacity: 1, scale: 1 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
							>
								<div class="msg-speaking-dots">
									<span class="work-dot" />
									<span class="work-dot" />
									<span class="work-dot" />
								</div>
								{props.worker && <div class="msg-sign">— {props.worker} is writing…</div>}
							</Motion>
						)}
					</AnimatePresence>
				</div>
			</section>
		</MotionConfigProvider>
	);
}
