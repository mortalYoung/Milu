import type { ReactNode } from "react";
import { useStore } from "zustand";
import { Show } from "../lib/jsx";
import type { ScrollFollower } from "../lib/scroll-follower";
import { cn } from "../lib/utils";

export function ScrollRegion(props: {
	scroll: ScrollFollower;
	id?: string;
	class?: string;
	innerClass?: string;
	innerClassList?: Record<string, boolean | undefined>;
	ariaLive?: "polite";
	children: ReactNode;
}) {
	const following = useStore(props.scroll.store, (state) => state.following);

	return (
		<div className="relative flex-1 min-h-0 flex flex-col">
			<section id={props.id} aria-live={props.ariaLive} ref={props.scroll.setContainer} className={cn("scroll-region overflow-y-auto overscroll-contain", props.class)}>
				<div ref={props.scroll.setContent} className={cn(props.innerClass, props.innerClassList)}>
					{props.children}
				</div>
			</section>
			<Show when={!following}>
				<button type="button" className="back-to-bottom" title="Back to latest" onClick={() => props.scroll.pin(true)}>
					↓ latest
				</button>
			</Show>
		</div>
	);
}
