/**
 * 每个文件的阅读现场（滚动位置、选中的行、折叠的块），按 LRU 留最近 10 个。
 * 切换 tab 时先把上一个文件的现场写进来，再把目标文件的现场铺回去 —— 和 VSCode 的
 * `viewState` 是同一件事。只有内存，不落盘。
 */
export interface FileViewState {
	/** 滚动容器自己的 scrollTop（px） */
	scrollTop: number;
	/** 存的时候文档有多少行：行数一致就按 px 精确还原，否则退化成"把首行顶到顶" */
	lines: number;
	/** 视口顶部那一行（1 起）；markdown 那种没有行概念的正文留 0 */
	topLine: number;
	/** 首行顶端离视口顶的像素（0 ~ 行高），让还原落在同一行内的同一处 */
	topOffset: number;
	/** 选中的行区间（0 起的行号，和 liveRange 同一个口径） */
	select: { start: number; end: number } | null;
	/** 折叠的块 */
	folds: { from: number; to: number }[];
}

export const VIEW_STATE_MAX = 10;

const cache = new Map<string, FileViewState>();

export function viewStateKey(partner: string | null | undefined, path: string): string {
	return `${partner ?? ""}\u0000${path}`;
}

/** 读一次即算用过：挪到队尾（Map 的插入序就是 LRU 序）。 */
export function readViewState(key: string): FileViewState | null {
	const state = cache.get(key);
	if (!state) return null;
	cache.delete(key);
	cache.set(key, state);
	return state;
}

export function writeViewState(key: string, state: FileViewState): void {
	cache.delete(key);
	cache.set(key, state);
	while (cache.size > VIEW_STATE_MAX) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) return;
		cache.delete(oldest);
	}
}

export function forgetViewState(key: string): void {
	cache.delete(key);
}
