import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	advanceNext,
	appendRun,
	applyFire,
	applyMiss,
	backoffMs,
	checkAgentCreate,
	createScheduleClock,
	duePlan,
	hasSchedules,
	jitterFor,
	loadSchedules,
	MAX_ACTIVE_DEFINITIONS,
	newDefinition,
	parseCronWhen,
	parseWhen,
	readRuns,
	reapZombies,
	reconcile,
	ScheduleBusyError,
	ScheduleConfigError,
	type ScheduleDefinition,
	type ScheduleRule,
	saveSchedules,
} from "../src/bun/core/schedules.ts";

const MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
	if (!ok) failures += 1;
}

function local(y: number, mo: number, d: number, h: number, mi: number): number {
	return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
}

function make(id: string, schedule: ScheduleRule, now: number, text = "do X"): ScheduleDefinition {
	return newDefinition({ id, title: id, display: text, schedule, payload: { kind: "prompt", text }, workspaceIdentity: "/tmp/ws", createdBy: "user", now });
}

const TZ = process.env.TZ ?? "(system)";
console.log(`\n# probe-schedules · TZ=${TZ}\n`);

// ——— 1. cron：每天 9 点 ———
{
	const created = local(2026, 10, 13, 14, 32);
	const def = make("s-daily", { kind: "cron", expression: "0 9 * * *" }, created);
	const first = def.nextRunAt ?? 0;
	check("cron 下一次落在明天 09:00（含 ≤15s 抖动）", first >= local(2026, 10, 14, 9, 0) && first < local(2026, 10, 14, 9, 0) + 15_000, new Date(first).toString());

	const onTime = duePlan([def], first + 30_000);
	check("到点后 30s 正常派发", onTime.fires.length === 1 && onTime.fires[0]?.trigger === "schedule");

	const fired = applyFire(def, onTime.fires[0]!, first + 30_000);
	check("派发成功后前推到次日 09:00", (fired.nextRunAt ?? 0) >= local(2026, 10, 15, 9, 0) && (fired.nextRunAt ?? 0) < local(2026, 10, 15, 9, 0) + 15_000);

	const grace = duePlan([def], first + 4 * MS.minute);
	check("晚 4 分钟仍在宽限内 → 跑", grace.fires.length === 1 && grace.missed.length === 0);
	const late = duePlan([def], first + 6 * MS.minute);
	check("晚 6 分钟超出宽限 → missed", late.fires.length === 0 && late.missed.length === 1);

	const overnight = duePlan([def], local(2026, 10, 14, 10, 30));
	const missedDef = overnight.missed[0] ? applyMiss(def, overnight.missed[0], local(2026, 10, 14, 10, 30)) : def;
	const after12h = missedDef.nextRunAt ?? 0;
	const after12hGap = after12h - local(2026, 10, 14, 10, 30);
	check("关 app 12h：cron 只留 1 条 missed，不补跑", overnight.fires.length === 0 && overnight.missed.length === 1);
	check("关 app 12h：下一次已重算为最近的 09:00", after12hGap > 0 && after12hGap <= 24 * MS.hour, `${(after12hGap / MS.hour).toFixed(2)}h`);

	const monthAway = local(2026, 11, 12, 10, 30);
	const plan30 = duePlan([def], monthAway);
	const after30 = plan30.missed[0] ? applyMiss(def, plan30.missed[0], monthAway) : def;
	check("关 app 30 天：只记 1 条 missed（不爆发）", plan30.missed.length === 1 && plan30.fires.length === 0);
	check("关 app 30 天：nextRunAt 落到 24h 内", (after30.nextRunAt ?? 0) > monthAway && (after30.nextRunAt ?? 0) - monthAway <= 24 * MS.hour);
}

// ——— 2. interval：每 15 分钟 ———
{
	const anchor = local(2026, 10, 13, 9, 0);
	const def = make("s-sync", { kind: "interval", anchor, everyMs: 15 * MS.minute }, anchor - MS.hour);
	const next = def.nextRunAt ?? 0;
	check("interval 首个到期点 = 锚点（含稳定抖动）", next >= anchor && next < anchor + 60_000, new Date(next).toString());

	const away = local(2026, 10, 13, 21, 7);
	const plan = duePlan([def], away);
	check("关机 12h：interval 合并成 1 次 catchup", plan.fires.length === 1 && plan.fires[0]?.trigger === "catchup");

	const fired = applyFire(def, plan.fires[0]!, away);
	const offset = (fired.nextRunAt ?? 0) - jitterFor(def.id, 60_000) - anchor;
	check("interval 无累积漂移（锚点 + 固定偏移的整倍数）", offset > 0 && offset % (15 * MS.minute) === 0, `offset=${offset / MS.minute}min`);

	const jump = duePlan([def], away + MS.hour);
	check("时钟前跳 1h：仍只补 1 次", jump.fires.length === 1);

	const back = duePlan([def], next - MS.minute);
	check("时钟回拨：不到点不派发", back.fires.length === 0 && back.missed.length === 0);
}

// ——— 3. once ———
{
	const at = local(2026, 10, 13, 18, 0);
	const def = make("s-once", { kind: "once", at }, local(2026, 10, 13, 12, 0));
	check("once：nextRunAt = 原时刻（不加抖动）", def.nextRunAt === at);

	const inWindow = duePlan([def], at + 2 * MS.minute);
	const fired = applyFire(def, inWindow.fires[0]!, at + 2 * MS.minute);
	check("once：窗口内补跑一次并终结", inWindow.fires.length === 1 && fired.nextRunAt === null && fired.lifecycleStatus === "finished");
	check("once：终结后不再派发", duePlan([fired], at + 5 * MS.day).fires.length === 0);

	const outside = duePlan([def], at + 30 * MS.minute);
	const missed = outside.missed[0] ? applyMiss(def, outside.missed[0], at + 30 * MS.minute) : def;
	check("once：窗口外记 missed 并终结（不重算下一次）", outside.missed.length === 1 && missed.nextRunAt === null && missed.lifecycleStatus === "finished");
}

// ——— 4. 抖动确定性 ———
{
	const rule: ScheduleRule = { kind: "cron", expression: "0 9 * * *" };
	const a = advanceNext("s-daily", rule, local(2026, 10, 13, 10, 0), true);
	const b = advanceNext("s-daily", rule, local(2026, 10, 13, 10, 0), true);
	check("抖动可复现（同 id 同偏移）", a === b);
	const offsets = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => jitterFor(id, 15_000)));
	check("抖动打散不同任务", offsets.size >= 5, `${offsets.size}/8 distinct`);
	check(
		"抖动在 [0,span) 内",
		["x", "y", "z"].every((id) => jitterFor(id, 60_000) < 60_000),
	);
	check("退避 30s×2^(n-1) 封顶 15min", backoffMs(1) === 30_000 && backoffMs(2) === 60_000 && backoffMs(6) === 900_000);
}

// ——— 5. 启动 reconcile ———
{
	const now = local(2026, 10, 13, 14, 0);
	const crashed: ScheduleDefinition = {
		...make("s-crashed", { kind: "interval", anchor: now - MS.hour, everyMs: MS.hour }, now - MS.hour),
		running: true,
		claimedAt: now - 30 * MS.minute,
	};
	const fresh: ScheduleDefinition = { ...make("s-fresh", { kind: "interval", anchor: now - MS.hour, everyMs: MS.hour }, now - MS.hour), running: true, claimedAt: now - 60_000 };
	const healed = reconcile([crashed, fresh], now);
	const at = healed.find((d) => d.id === "s-crashed")!;
	check("启动 reconcile：崩掉的认领被回收", at.running === false && at.claimedAt === null);
	check(
		"启动 reconcile：无条件清空 running（含刚殁的认领）",
		healed.every((d) => d.running === false && d.claimedAt === null),
	);
	check("启动 reconcile：不沿用磁盘旧 nextRunAt", (at.nextRunAt ?? 0) > now);
	const reaped = reapZombies([crashed, fresh], now);
	check("僵尸回收：10 分钟内的认领仍被尊重", reaped.find((d) => d.id === "s-fresh")!.running === true);
	check("僵尸回收：超过 10 分钟的认领被回收", reaped.find((d) => d.id === "s-crashed")!.running === false);
}

// ——— 6. clock：并发上限 / 每日上限 / 落盘 ———
{
	const dir = await mkdtemp(join(tmpdir(), "probe-schedules-"));
	try {
		let current = local(2026, 10, 13, 9, 0);
		const now = () => current;
		const rules: ScheduleRule = { kind: "interval", anchor: current, everyMs: MS.minute };
		const defs = ["a", "b", "c", "d"].map((id) => ({ ...make(`s-${id}`, rules, current), nextRunAt: current + MS.minute }));
		await saveSchedules(dir, defs);

		const dispatched: string[] = [];
		const clock = createScheduleClock({
			partnerDir: dir,
			now,
			maxConcurrent: 3,
			dailyCap: 200,
			dispatch: async (fire) => void (await clock.noteDispatched(fire), dispatched.push(fire.id)),
		});
		await clock.start();
		current += 3 * MS.minute;
		await clock.tick();
		const runs = await readRuns(dir);
		const skipped = runs.filter((r) => r.status === "skipped");
		check("全局并发 3：第 4 条记 skipped", dispatched.length === 3 && skipped.length === 1, `dispatched=${dispatched.length} skipped=${skipped.length}`);
		check("runs.jsonl 落盘 dispatched 记录", runs.filter((r) => r.status === "dispatched").length === 3);
		const reloaded = await loadSchedules(dir);
		check("派发后 running/claimedAt 已写盘", reloaded.filter((d) => d.running).length === 3 && reloaded.every((d) => d.nextRunAt != null));

		const capDir = await mkdtemp(join(tmpdir(), "probe-schedules-cap-"));
		try {
			const capDefs = ["a", "b", "c"].map((id) => ({ ...make(`s-${id}`, { kind: "interval", anchor: current, everyMs: MS.minute }, current), nextRunAt: current + MS.minute }));
			await saveSchedules(capDir, capDefs);
			let dispatchedCap = 0;
			const capClock = createScheduleClock({
				partnerDir: capDir,
				now,
				maxConcurrent: 5,
				dailyCap: 2,
				dispatch: async () => void (dispatchedCap += 1),
			});
			await capClock.start();
			current += 2 * MS.minute;
			for (let i = 0; i < 3; i++) await clock.tick();
			await appendRun(capDir, { runId: "seed:1", scheduleId: "seed", scheduledAt: current, dispatchedAt: current, trigger: "schedule", status: "dispatched", attempts: 0 });
			await appendRun(capDir, { runId: "seed:2", scheduleId: "seed", scheduledAt: current, dispatchedAt: current, trigger: "schedule", status: "dispatched", attempts: 0 });
			await capClock.tick();
			const capRuns = await readRuns(capDir);
			const capped = capRuns.filter((r) => r.error === "daily-cap");
			const paused = (await loadSchedules(capDir)).filter((d) => d.lifecycleStatus === "paused" && !d.enabled);
			check(
				"每日上限：超出后记 skipped/daily-cap 并 paused",
				capped.length >= 1 && paused.length >= 1,
				`dispatched=${dispatchedCap} capped=${capped.length} paused=${paused.length}`,
			);
		} finally {
			await rm(capDir, { recursive: true, force: true });
		}
		clock.stop();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

// ——— 7. DST：跨夏令时切换，「每天 9 点」仍是本地 9 点 ———
{
	const def = make("s-daily", { kind: "cron", expression: "0 9 * * *" }, local(2026, 3, 6, 12, 0));
	let cursor = local(2026, 3, 6, 12, 0);
	const hours: number[] = [];
	for (let i = 0; i < 4; i++) {
		cursor = duePlan([def], cursor).nextWakeAt ?? advanceNext(def.id, def.schedule, cursor, true)!;
		hours.push(new Date(cursor).getHours());
		cursor += 1000;
	}
	check(
		"跨 DST 边界：每次都在本地 09:00",
		hours.every((h) => h === 9),
		`hours=${hours.join(",")}`,
	);

	const skippedHour = make("s-dst", { kind: "cron", expression: "30 2 * * *" }, local(2026, 3, 6, 12, 0));
	const plan = duePlan([skippedHour], local(2026, 3, 9, 12, 0));
	const after = plan.missed[0] ? applyMiss(skippedHour, plan.missed[0], local(2026, 3, 9, 12, 0)) : skippedHour;
	check("DST 不存在的时刻不崩溃且能推进", after.nextRunAt != null && (after.nextRunAt ?? 0) > local(2026, 3, 9, 12, 0), new Date(after.nextRunAt ?? 0).toString());
}

// ——— 8. when 解析 / 编辑 / settle ———
{
	const now = local(2026, 10, 13, 9, 0);
	const daily = parseWhen("cron:0 9 * * *", now);
	const every = parseWhen("every:15m", now);
	const once = parseWhen("at:" + (now + 2 * MS.hour), now);
	check("when 解析：cron / every / at", !daily.error && !every.error && !once.error);
	check(
		"when 解析：人话（界面路径）",
		["每天 10:30", "每天10:30", "每天 10 点半", "每天 9 点", "every day at 10:30", "每 15 分钟", "每小时", "每半小时", "每周五 17:30"].every(
			(input) => !parseWhen(input, now).error,
		),
	);
	check(
		"when 解析：工具只收 cron",
		["30 10 * * *", "*/15 * * * *", "0 9 * * 1-5", "0 0 1 * *"].every((input) => !parseCronWhen(input, now).error),
	);
	check(
		"when 拒绝：工具不收人话或非 5 段",
		["每天 10:30", "每 15 分钟", "every day at 10:30", "2026-10-20 09:00", "0 9 * *", "0 9 * * * *", ""].every((input) => Boolean(parseCronWhen(input, now).error)),
	);
	check("when 兼容：工具容忍 cron: 前缀", !parseCronWhen("cron:30 10 * * *", now).error && parseCronWhen("cron:30 10 * * *", now).describe === "cron 30 10 * * *");
	check("when 回显可读", daily.describe === "daily 09:00" && every.describe === "every 15m", `${daily.describe} | ${every.describe}`);
	check("when 拒绝：秒级下限", Boolean(parseWhen("every:30s", now).error));
	check(
		"when 语义：新建的 interval 首次在 15 分钟后（不是立刻）",
		duePlan([make("s-new", every.rule, now)], now).fires.length === 0 && (every.rule.kind === "interval" ? every.rule.anchor : 0) === now + 15 * MS.minute,
	);
	check("when 拒绝：过去时刻", Boolean(parseWhen("at:" + (now - 1000), now).error));
	check("when 拒绝：坏 cron", Boolean(parseWhen("cron:not a cron", now).error));

	const dir = await mkdtemp(join(tmpdir(), "probe-schedules-edit-"));
	try {
		let current = local(2026, 10, 13, 9, 0);
		const now = () => current;
		const created = make("s-edit", { kind: "interval", anchor: current, everyMs: 15 * MS.minute }, current);
		await saveSchedules(dir, [created]);
		const dispatched: string[] = [];
		const settled: string[] = [];
		const clock = createScheduleClock({
			partnerDir: dir,
			now,
			dispatch: async (fire) => void (await clock.noteDispatched(fire), dispatched.push(fire.trigger)),
			onSettle: (record) => void settled.push(record.status),
		});
		await clock.start();

		await clock.update((items) => items.map((item) => ({ ...item, enabled: false, lifecycleStatus: "paused" as const })));
		current += 5 * MS.minute;
		await clock.tick();
		check("暂停中的定义不派发", dispatched.length === 0);

		await clock.update((items) =>
			items.map((item) => ({ ...item, enabled: true, lifecycleStatus: "active" as const, nextRunAt: advanceNext(item.id, item.schedule, current, true) })),
		);
		current += 20 * MS.minute;
		await clock.tick();
		check("恢复后按新时刻派发", dispatched.length === 1);

		await clock.settle("s-edit", "done");
		const runs = await readRuns(dir);
		check("settle 认回同一条 runId（不重复计数）", runs.filter((r) => r.runId === runs[0]!.runId).length === 2, `${runs.length} rows`);
		check("settle 记终态并回调", settled[0] === "done" && (await loadSchedules(dir)).every((d) => !d.running));

		await clock.update((items) =>
			items.map((item) => ({
				...item,
				schedule: { kind: "cron", expression: "0 9 * * *" },
				nextRunAt: advanceNext(item.id, { kind: "cron", expression: "0 9 * * *" }, current, true),
			})),
		);
		check("改时间后 nextRunAt 重算到下一个 9 点", new Date((await loadSchedules(dir))[0]!.nextRunAt ?? 0).getHours() === 9);
		clock.stop();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

// ——— 9. 配置型失败：立即 paused，不退避 ———
{
	const dir = await mkdtemp(join(tmpdir(), "probe-schedules-config-"));
	try {
		let current = local(2026, 10, 13, 9, 0);
		const now = () => current;
		const def = make("s-config", { kind: "interval", anchor: current, everyMs: MS.minute }, current);
		await saveSchedules(dir, [def]);
		let calls = 0;
		const clock = createScheduleClock({
			partnerDir: dir,
			now,
			maxConcurrent: 3,
			dailyCap: 200,
			dispatch: async () => {
				calls += 1;
				throw new ScheduleConfigError("workspace changed");
			},
		});
		await clock.start();
		current += 90_000;
		await clock.tick();
		const after = (await loadSchedules(dir))[0]!;
		check("配置型失败：立即 paused 且不排重试", calls === 1 && after.lifecycleStatus === "paused" && after.enabled === false && after.retryAt === null);
		current += 10 * MS.minute;
		await clock.tick();
		check("配置型失败：不再重试", calls === 1);
		clock.stop();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

// ——— 10. 运行型失败：退避重试 ———
{
	const dir = await mkdtemp(join(tmpdir(), "probe-schedules-ops-"));
	try {
		let current = local(2026, 10, 13, 9, 0);
		const now = () => current;
		const def = make("s-ops", { kind: "interval", anchor: current, everyMs: MS.minute }, current);
		await saveSchedules(dir, [def]);
		let calls = 0;
		const clock = createScheduleClock({
			partnerDir: dir,
			now,
			dispatch: async () => {
				calls += 1;
				throw new Error("network down");
			},
		});
		await clock.start();
		current += 90_000;
		await clock.tick();
		const failed = (await loadSchedules(dir))[0]!;
		check("运行型失败：排下一次退避（30s 起）", failed.retryAt != null && (failed.retryAt ?? 0) - current <= 30_000 && failed.lifecycleStatus === "active");
		current = (failed.retryAt ?? current) + 1;
		await clock.tick();
		check("退避到点会重试", calls === 2);
		clock.stop();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

// ——— 11. 重叠：skip，不排队、不重试 ———
{
	const dir = await mkdtemp(join(tmpdir(), "probe-schedules-busy-"));
	try {
		let current = local(2026, 10, 13, 9, 0);
		const now = () => current;
		const def = make("s-busy", { kind: "interval", anchor: current, everyMs: MS.minute }, current);
		await saveSchedules(dir, [def]);
		let calls = 0;
		const clock = createScheduleClock({
			partnerDir: dir,
			now,
			dispatch: async () => {
				calls += 1;
				throw new ScheduleBusyError("partner is busy");
			},
		});
		await clock.start();
		current += 90_000;
		await clock.tick();
		const runs = await readRuns(dir);
		const after = (await loadSchedules(dir))[0]!;
		check("重叠：记 skipped 且不排重试", runs.some((r) => r.status === "skipped") && after.retryAt === null && after.lifecycleStatus === "active");
		check("重叠：不占 runCount，也不算失败", after.runCount === 0 && after.lastError === null);
		current += 10 * MS.minute;
		await clock.tick();
		check("重叠后按下一个周期继续（不爆发）", calls === 2);
		clock.stop();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

// ——— 12. 模型侧创建守卫 ———
{
	const now = local(2026, 10, 13, 9, 0);
	const every5 = parseWhen("every:5m", now).rule;
	const every15 = parseWhen("every:15m", now).rule;
	const daily = parseWhen("cron:0 9 * * *", now).rule;
	const everyMinuteCron = parseWhen("cron:* * * * *", now).rule;
	const once = parseWhen("at:" + (now + 2 * MS.hour), now).rule;

	check("守卫：模型不能排 5 分钟一次", checkAgentCreate([], every5, now) != null);
	check("守卫：15 分钟放行", checkAgentCreate([], every15, now) === null);
	check(
		"守卫：cron */5 被拒（同一个 15 分钟下限）",
		checkAgentCreate([], parseCronWhen("*/5 * * * *", now).rule, now) != null && checkAgentCreate([], parseCronWhen("*/15 * * * *", now).rule, now) === null,
	);
	check("守卫：每天 9 点放行", checkAgentCreate([], daily, now) === null);
	check("守卫：每分钟的 cron 被拒", checkAgentCreate([], everyMinuteCron, now) != null);
	check("守卫：一次性任务放行（无第二次）", checkAgentCreate([], once, now) === null);

	const many = Array.from({ length: MAX_ACTIVE_DEFINITIONS }, (_, index) => make(`s-${index}`, daily, now));
	const paused = make("s-paused", daily, now);
	check("守卫：20 条上限", checkAgentCreate(many, daily, now) != null);
	check(
		"守卫：暂停的不占上限",
		checkAgentCreate([...many.slice(0, MAX_ACTIVE_DEFINITIONS - 1), { ...paused, enabled: false, lifecycleStatus: "paused" as const }], daily, now) === null,
	);
}

// ——— 13. 手动运行与结算必须认同一条 runId（不能凭空造一条） ———
{
	const dir = await mkdtemp(join(tmpdir(), "probe-schedules-manual-"));
	try {
		let current = local(2026, 10, 13, 10, 23, 59);
		const now = () => current;
		const def = make("s-manual", { kind: "cron", expression: "30 10 * * *" }, current);
		await saveSchedules(dir, [def]);
		const settled: string[] = [];
		const clock = createScheduleClock({
			partnerDir: dir,
			now,
			dispatch: async () => {},
			onSettle: (record) => void settled.push(`${record.runId}|${record.trigger}|${record.status}`),
		});
		await clock.start();

		current = local(2026, 10, 13, 10, 24, 35);
		await clock.noteDispatched({ kind: "fire", id: "s-manual", runId: "s-manual:manual:abc123", scheduledAt: current, retry: 0, trigger: "manual" });
		current = local(2026, 10, 13, 10, 24, 39);
		await clock.settle("s-manual", "done", { runId: "s-manual:manual:abc123" });
		const runs = await readRuns(dir);
		check("手动运行：ledger 里只有 dispatched + done 两条", runs.length === 2, `${runs.length} rows`);
		check("手动运行：终态认同一 runId 且 trigger 保持 manual", runs[1]?.runId === "s-manual:manual:abc123" && runs[1]?.trigger === "manual" && runs[1]?.status === "done");
		check("手动运行：结算回调带的是那一条", settled[0] === "s-manual:manual:abc123|manual|done");
		check(
			"手动运行：不动 nextRunAt",
			(await loadSchedules(dir))[0]?.nextRunAt != null &&
				new Date((await loadSchedules(dir))[0]!.nextRunAt!).getHours() === 10 &&
				new Date((await loadSchedules(dir))[0]!.nextRunAt!).getMinutes() === 30,
		);

		current = local(2026, 10, 13, 11, 0);
		await clock.settle("s-manual", "done", { runId: "s-manual:does-not-exist" });
		check("结算找不到对应行时什么都不写（不造幻影）", (await readRuns(dir)).length === 2);
		clock.stop();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

// ——— 14. 没任务的 partner 不该被造出一份空定义文件 ———
{
	const dir = await mkdtemp(join(tmpdir(), "probe-schedules-empty-"));
	try {
		const clock = createScheduleClock({ partnerDir: dir, dispatch: async () => {} });
		await clock.start();
		check("启动：没有任务时不写 tasks.json", (await hasSchedules(dir)) === false);
		const created = make("s-empty", { kind: "cron", expression: "30 10 * * *" }, Date.now());
		await clock.update((items) => [...items, created]);
		check("创建第一条时才落盘", (await hasSchedules(dir)) === true && (await loadSchedules(dir)).length === 1);
		clock.stop();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}  (TZ=${TZ})\n`);
process.exit(failures === 0 ? 0 : 1);
