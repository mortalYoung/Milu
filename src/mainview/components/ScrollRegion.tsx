import { type ReactNode, type RefObject, useLayoutEffect } from "react";
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
	root?: RefObject<HTMLDivElement | null>;
	overlay?: ReactNode;
	onScroll?: (el: HTMLElement) => void;
	children: ReactNode;
}) {
	const following = useStore(props.scroll.store, (state) => state.following);

	useLayoutEffect(() => {
		props.scroll.pinNow();
	});

	return (
		<div className="relative flex-1 min-h-0 flex flex-col" ref={props.root}>
			<section
				id={props.id}
				aria-live={props.ariaLive}
				ref={props.scroll.setContainer}
				onScroll={props.onScroll ? (event) => props.onScroll?.(event.currentTarget) : undefined}
				className={cn("scroll-region overflow-y-auto overscroll-contain", props.class)}
			>
				<div ref={props.scroll.setContent} className={cn(props.innerClass, props.innerClassList)}>
					{props.children}
				</div>
			</section>
			<Show when={!following}>
				<button type="button" className="back-to-bottom" title="Back to latest" onClick={() => props.scroll.pin(true)}>
					↓ latest
				</button>
			</Show>
			{props.overlay}
		</div>
	);
}
