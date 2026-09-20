import { type Accessor, type JSX, Show } from "solid-js";
import type { ScrollFollower } from "../lib/scroll-follower";

export function ScrollRegion(props: {
	scroll: ScrollFollower;
	content: Accessor<readonly unknown[]>;
	id?: string;
	class?: string;
	innerClass?: string;
	innerClassList?: Record<string, boolean | undefined>;
	ariaLive?: "polite";
	children: JSX.Element;
}) {
	return (
		<div class="relative flex-1 min-h-0 flex flex-col">
			<section id={props.id} aria-live={props.ariaLive} ref={props.scroll.setContainer} class={"scroll-region overflow-y-auto overscroll-contain " + (props.class ?? "")}>
				<div ref={props.scroll.setContent} class={props.innerClass} classList={props.innerClassList}>
					{props.children}
				</div>
			</section>
			<Show when={!props.scroll.following()}>
				<button class="back-to-bottom" title="Back to latest" onClick={() => props.scroll.pin(true)}>
					↓ latest
				</button>
			</Show>
		</div>
	);
}
