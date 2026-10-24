export const MENU =
	"absolute bottom-[calc(100%+8px)] left-1/2 z-50 max-h-[240px] w-[calc(100%_-_2rem)] max-w-[var(--transcript-measure)] -translate-x-1/2 overflow-y-auto rounded-md border border-line bg-surface py-1 animate-[command-menu-in_180ms_var(--ease-out)] motion-reduce:animate-none";

export const ITEM = "flex w-full cursor-pointer items-center gap-2 bg-transparent px-3 py-1.5 text-left font-mono text-[12px] text-ink hover:bg-hover";

export const NAME = "shrink-0 text-signal";

export const DESC = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-muted";

export const HINT = "shrink-0 text-muted";

export const BADGE =
	"shrink-0 rounded-[4px] border border-[color-mix(in_srgb,var(--signal)_30%,transparent)] px-1 py-[1px] font-sans text-[10px] tracking-[0.08em] text-signal uppercase";

export const HEADER = "px-3 pt-1.5 pb-0.5 font-sans text-[10px] tracking-[0.14em] text-muted uppercase";

export const EMPTY = "px-3 py-1.5 font-mono text-[10px] text-muted";
