const WEEKDAYS: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

export interface ParsedScheduleInput {
	/** The canonical form the scheduler understands: `cron:<5 fields>` · `every:<n>m` · `at:<epoch ms>`. */
	when: string;
	/** The structured rule read back at whoever typed it. */
	echo: string;
	error?: string;
}

export const WHEN_HINT = "试试「每天 9:00」「每天 9 点」「每 15 分钟」「每小时」「每周五 17:30」「0 9 * * *」「2026-10-20 09:00」";

const pad = (value: number) => String(value).padStart(2, "0");
const clock = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`;
const validTime = (hour: number, minute: number) => hour <= 23 && minute <= 59;

function cron(minute: number, hour: number, day = "*"): ParsedScheduleInput {
	return {
		when: `cron:${minute} ${hour} * * ${day}`,
		echo: `${day === "*" ? "每天" : `每周${WEEKDAY_LABELS[Number(day)]}`} ${clock(hour, minute)} · cron ${minute} ${hour} * * ${day}`,
	};
}

function every(minutes: number): ParsedScheduleInput {
	const label = minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟`;
	return { when: `every:${minutes}m`, echo: `每 ${label} · interval ${minutes}m` };
}

/** What somebody typed — a human, or the model reading the tool description — becomes one canonical clock string. */
export function parseScheduleInput(raw: string, now = Date.now()): ParsedScheduleInput {
	const input = raw.trim();
	if (!input) return { when: "", echo: "", error: `写个时间，比如「每天 9:00」` };
	if (input.startsWith("cron:")) {
		const expression = input.slice(5).replace(/\s+/g, " ").trim();
		return { when: `cron:${expression}`, echo: `cron ${expression}` };
	}
	if (input.startsWith("every:")) return { when: input, echo: `interval ${input.slice(6)}` };
	if (input.startsWith("at:")) {
		const at = Number(input.slice(3).trim());
		if (!Number.isFinite(at)) return { when: "", echo: "", error: "时刻不认识" };
		const date = new Date(at);
		return { when: `at:${at}`, echo: `只跑一次 · ${MONTHS[date.getMonth()]} ${date.getDate()} ${clock(date.getHours(), date.getMinutes())}` };
	}

	const weekly = input.match(/(?:每周|每星期|weekly|every)\s*([一二三四五六日天]|sun|mon|tue|wed|thu|fri|sat)\s*(\d{1,2})[:：](\d{2})/i);
	if (weekly) {
		const day = WEEKDAYS[weekly[1]!.toLowerCase()];
		const hour = Number(weekly[2]);
		const minute = Number(weekly[3]);
		if (day == null || !validTime(hour, minute)) return { when: "", echo: "", error: "时间不认识" };
		return cron(minute, hour, String(day));
	}

	const daily = input.match(/(?:每天|每日|daily|every\s*day)\s*(?:at\s*)?(\d{1,2})\s*[:：]\s*(\d{2})/i);
	if (daily) {
		const hour = Number(daily[1]);
		const minute = Number(daily[2]);
		if (!validTime(hour, minute)) return { when: "", echo: "", error: "时间不认识" };
		return cron(minute, hour);
	}

	const chineseHour = input.match(/(?:每天|每日)\s*(\d{1,2})\s*(?:点|点钟|点整)\s*(?:(半)|(\d{1,2})\s*分?)?/);
	if (chineseHour) {
		const hour = Number(chineseHour[1]);
		const minute = chineseHour[2] ? 30 : Number(chineseHour[3] ?? 0);
		if (!validTime(hour, minute)) return { when: "", echo: "", error: "时间不认识" };
		return cron(minute, hour);
	}

	if (/(?:每小时|每个小时|hourly|every\s*hour)/i.test(input)) return every(60);
	if (/(?:每半小时|every\s*half\s*hour)/i.test(input)) return every(30);

	if (/(?:每|每隔|every)\s*\d+\s*(?:秒|seconds?|sec|s)(?![a-z])/i.test(input)) return { when: "", echo: "", error: "最短 1 分钟" };

	const interval = input.match(/(?:每|每隔|every)\s*(\d+)\s*(分钟|分|minutes?|min|m|小时|时|hours?|hour|h)(?![a-z])/i);
	if (interval) {
		const amount = Number(interval[1]);
		const unit = interval[2]!.toLowerCase();
		const minutes = unit.startsWith("h") || unit.startsWith("小时") || unit.startsWith("时") ? amount * 60 : amount;
		if (minutes < 1) return { when: "", echo: "", error: "最短 1 分钟" };
		return every(minutes);
	}

	const stamp = input.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2})[:：](\d{2})/);
	if (stamp) {
		const at = new Date(Number(stamp[1]), Number(stamp[2]) - 1, Number(stamp[3]), Number(stamp[4]), Number(stamp[5]), 0, 0).getTime();
		if (!Number.isFinite(at) || at <= now) return { when: "", echo: "", error: "这个时刻已经过去了" };
		return { when: `at:${at}`, echo: `${stamp[2]}月${stamp[3]}日 ${clock(Number(stamp[4]), Number(stamp[5]))} · 只跑一次` };
	}

	const bare = input.match(/^(\d{1,2})[:：](\d{2})$/);
	if (bare) {
		const hour = Number(bare[1]);
		const minute = Number(bare[2]);
		if (!validTime(hour, minute)) return { when: "", echo: "", error: "时间不认识" };
		return cron(minute, hour);
	}

	const expression = input
		.replace(/^cron:/i, "")
		.replace(/\s+/g, " ")
		.trim();
	if (/^[\d*/,\-]+(?:\s+[\d*/,\-]+){4}$/.test(expression)) return { when: `cron:${expression}`, echo: `cron ${expression}` };

	return { when: "", echo: "", error: `没读懂。${WHEN_HINT}` };
}
