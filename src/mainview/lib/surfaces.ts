export const SURFACE = {
	reader: "explorer.reader",
	diff: "git.diff",
	settings: "settings.page",
	taskLog: "dialog.taskLog",
	transcript: "chat.transcript",
	chatList: "chat.list",
} as const;

export type SurfaceId = (typeof SURFACE)[keyof typeof SURFACE];
