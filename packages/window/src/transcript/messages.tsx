import { type ImageRef, SLOT_POINTS } from "@milu/protocol";
import { useState } from "react";
import { useStore } from "zustand";

import { useScrollEdges } from "../api/scroll-edges.ts";
import { Tip } from "../api/tooltip.tsx";
import { copyText } from "../clipboard.ts";
import { useImageUrl } from "../images.ts";
import { Markdown } from "../markdown/react.tsx";
import type { MarkdownEnv, MarkdownPort } from "../markdown/types.ts";
import type { Host } from "../surfaces.ts";
import { formatHistoryTime, type ViewItem } from "../view.ts";

const NO_ITEMS: readonly never[] = [];

function CopyButton(props: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Tip label={copied ? "Copied" : "Copy message"}>
			<button
				type="button"
				className={copied ? "msg-copy copied" : "msg-copy"}
				aria-label={copied ? "Copied" : "Copy message"}
				onClick={() => {
					void copyText(props.text);
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1200);
				}}
			>
				{copied ? (
					<svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<path d="M20 6 9 17l-5-5" />
					</svg>
				) : (
					<svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
						<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
					</svg>
				)}
			</button>
		</Tip>
	);
}

export function MessageMeta(props: { host: Host; item: ViewItem; className?: string }) {
	const items = useStore(props.host.slots.store, (state) => state.points[SLOT_POINTS.messageMeta] ?? NO_ITEMS);
	const components = useStore(props.host.slots.store, (state) => state.components);
	return (
		<div className={props.className === undefined ? "msg-meta" : `msg-meta ${props.className}`}>
			<CopyButton text={props.item.text} />
			{props.item.from === undefined || props.item.from === "" ? null : (
				<>
					<span className="msg-from">{props.item.from}</span>
					<span className="msg-dot">·</span>
				</>
			)}
			{items.map((slot) => {
				const Widget = components.get(slot.component);
				return Widget === undefined ? null : <Widget key={slot.id} host={props.host} data={props.item} />;
			})}
			<time className="msg-at" dateTime={new Date(props.item.time).toISOString()}>
				{formatHistoryTime(props.item.time)}
			</time>
		</div>
	);
}

function MessageImage(props: { host: Host; session: string; image: ImageRef }) {
	const url = useImageUrl(props.host.images, props.session, props.image);
	const label = props.image.name ?? "image";
	if (url === undefined) return <div className="msg-image is-pending" aria-label={label} />;
	return (
		<button
			type="button"
			className="msg-image-button"
			aria-label={`Open ${label}`}
			onClick={() => {
				void props.host.actions.invoke("image.preview", props.session, { src: url, alt: label }).catch(() => undefined);
			}}
		>
			<img className="msg-image" src={url} alt={label} width={props.image.width} height={props.image.height} draggable={false} />
		</button>
	);
}

export function UserMessage(props: { host: Host; session?: string; item: ViewItem }) {
	const schedule = props.item.schedule;
	const session = props.session;
	const [bubble, edges] = useScrollEdges<HTMLDivElement>();
	return (
		<div className="msg-block msg-block-user" data-entry={props.item.id}>
			{schedule ? (
				<div className="msg-origin">
					<span className="msg-origin-badge">scheduled</span>
					<span className="msg-origin-title">{schedule.title}</span>
					<span className="msg-origin-when">{schedule.trigger === "manual" ? "manual" : "on time"}</span>
					{schedule.status ? <span className={"msg-origin-status is-" + schedule.status}>{schedule.status === "dispatched" ? "sent" : schedule.status}</span> : null}
					{schedule.error ? <span className="msg-origin-error">{schedule.error}</span> : null}
				</div>
			) : null}
			{props.item.images === undefined || session === undefined ? null : (
				<div className="msg-images">
					{props.item.images.map((image) => (
						<MessageImage key={image.attachmentId} host={props.host} session={session} image={image} />
					))}
				</div>
			)}
			{props.item.text === "" ? null : (
				<div className={`msg-user read-clamp ${edges}`} ref={bubble}>
					{props.item.text}
				</div>
			)}
			<MessageMeta host={props.host} item={props.item} />
		</div>
	);
}

export function PeerMessage(props: { host: Host; item: ViewItem; port: MarkdownPort }) {
	return (
		<div className="msg-reply" data-entry={props.item.id}>
			<MessageMeta host={props.host} item={props.item} className="msg-reply-meta" />
			<div className="msg-reply-body read-clamp">
				<Markdown port={props.port} text={props.item.text} />
			</div>
		</div>
	);
}

export function AgentMessage(props: { host: Host; item: ViewItem; env?: MarkdownEnv; live?: boolean }) {
	return (
		<div className={props.live === true ? "msg-block msg-block-agent is-live" : "msg-block msg-block-agent"} data-entry={props.item.id}>
			<Markdown port={props.host.markdown} text={props.item.text} env={props.env} className="msg-body" plain={props.live} />
			<MessageMeta host={props.host} item={props.item} className={props.live === true ? "invisible" : undefined} />
		</div>
	);
}
