import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { createServiceId, DisposableStore, Emitter, type Event, type Service } from "@milu/di";
import { composerDataKey, type ComposerTip, type ComposerWidget, type ContributionItem, type SeqEntry, type SessionRow, type SessionSignal, type SlotItem } from "@milu/protocol";

import {
	COMPOSER_LEFT_POINT,
	COMPOSER_RIGHT_POINT,
	COMPOSER_TIPS_POINT,
	type ComposerTipItem,
	type ComposerWidgetItem,
	SESSION_MENU_POINT,
	SESSION_SIGNAL_POINT,
	type SessionMenuItem,
	type SessionSignalItem,
	type SessionValue,
} from "../extensions/types.ts";
import { clearForking, forkingOf, markForking, profileOf, type SessionProfile, writeProfile } from "../session/files.ts";
import { Session } from "../session/session.ts";
import type { AgentLoopEvent } from "./agent-loop.ts";
import { ICompactionService } from "./compaction.ts";
import type { CompactionService } from "./compaction.ts";
import { IContributionService } from "./contributions.ts";
import type { ContributionPoint, ContributionService } from "./contributions.ts";
import { IExecutionService } from "./execution.ts";
import type { ExecutionService } from "./execution.ts";
import { IHookService } from "./hooks.ts";
import type { HookService } from "./hooks.ts";
import { IModelsService } from "./models.ts";
import type { ModelsService } from "./models.ts";
import { IPromptService } from "./prompt.ts";
import type { PromptService } from "./prompt.ts";
import { ISettingsService } from "./settings.ts";
import { expandHome, type SettingsService } from "./settings.ts";
import { IToolService } from "./tools.ts";
import type { ToolService } from "./tools.ts";

export interface SessionEntry {
	readonly session: string;
	readonly entry: SeqEntry;
}

export interface SessionLoopEvent {
	readonly session: string;
	readonly event: AgentLoopEvent;
}

export interface SessionForkEvent {
	readonly session: string;
	readonly error?: string;
}

export interface SessionCompactingEvent {
	readonly session: string;
	readonly compacting: boolean;
}

export class SessionService implements Service {
	readonly onEntry: Event<SessionEntry>;
	readonly onLoopEvent: Event<SessionLoopEvent>;
	readonly onFork: Event<SessionForkEvent>;
	readonly onCompacting: Event<SessionCompactingEvent>;

	private _partnerRoot = "";
	private readonly _sessions = new Map<string, Session>();
	private readonly _relays = new Map<string, DisposableStore>();
	private readonly _entryEmitter = new Emitter<SessionEntry>();
	private readonly _loopEmitter = new Emitter<SessionLoopEvent>();
	private readonly _forkEmitter = new Emitter<SessionForkEvent>();
	private readonly _compactingEmitter = new Emitter<SessionCompactingEvent>();
	private readonly _forks = new Map<string, Promise<void>>();

	constructor(
		@IExecutionService private readonly _executionService: ExecutionService,
		@ISettingsService private readonly _settingsService: SettingsService,
		@IModelsService private readonly _modelsService: ModelsService,
		@IToolService private readonly _toolService: ToolService,
		@IContributionService private readonly _contributionService: ContributionService,
		@IPromptService private readonly _promptService: PromptService,
		@IHookService private readonly _hookService: HookService,
		@ICompactionService private readonly _compactionService: CompactionService,
	) {
		this.onEntry = this._entryEmitter.event;
		this.onLoopEvent = this._loopEmitter.event;
		this.onFork = this._forkEmitter.event;
		this.onCompacting = this._compactingEmitter.event;
	}

	async initialize(): Promise<void> {
		this._partnerRoot = expandHome(this._settingsService.get().partner_profile_path);
		await this._discardIncomplete();
	}

	get partnerRoot(): string {
		return this._partnerRoot;
	}

	async list(): Promise<readonly SessionRow[]> {
		const rows = await Promise.all((await this._names()).map((name) => this._rowOf(this.get(name))));
		return rows.sort((left, right) => (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0) || left.name.localeCompare(right.name));
	}

	get(name: string): Session {
		const existing = this._sessions.get(name);
		if (existing) return existing;

		const session = new Session({
			name,
			root: join(this._partnerRoot, name),
			executionService: this._executionService,
			modelsService: this._modelsService,
			toolService: this._toolService,
			promptService: this._promptService,
			hookService: this._hookService,
			compactionService: this._compactionService,
			settingsService: this._settingsService,
		});
		this._sessions.set(name, session);

		const relays = new DisposableStore();
		relays.add(session.onEntry((entry) => this._entryEmitter.fire({ session: name, entry })));
		relays.add(session.onLoopEvent((event) => this._loopEmitter.fire({ session: name, event })));
		relays.add(session.onCompacting((compacting) => this._compactingEmitter.fire({ session: name, compacting })));
		this._relays.set(name, relays);
		return session;
	}

	async ensure(name: string): Promise<Session> {
		if (!(await this._names()).includes(name)) throw new Error(`no session named "${name}"`);
		return this.get(name);
	}

	async names(): Promise<string[]> {
		return this._names();
	}

	/** Up to 64 characters, case-insensitive, the way a session name has always been chosen. */
	private async _nameFor(base: string, used: readonly string[]): Promise<string> {
		const taken = new Set(used.map((name) => name.toLowerCase()));
		const trimmed = base.slice(0, 64);
		if (!taken.has(trimmed.toLowerCase())) return trimmed;
		for (let index = 2; ; index += 1) {
			const suffix = `-${index}`;
			const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
			if (!taken.has(candidate.toLowerCase())) return candidate;
		}
	}

	/**
	 * A copy of a chat, directory and all. `fork` makes it a branch of the source; `duplicate` keeps
	 * the source's own parent, so copying a fork yields a sibling.
	 */
	async copy(name: string, mode: "fork" | "duplicate"): Promise<string> {
		if (this.running(name)) throw new Error(`"${name}" is still running; wait for it to finish`);
		const source = await this.ensure(name);
		const profile = await profileOf(source.root);
		if (mode === "fork" && profile?.forkedFrom !== undefined) throw new Error(`"${name}" is a fork; promote it before forking`);
		const target = await this._nameFor(mode === "fork" ? `${name}-fork` : name, await this._names());
		const dir = join(this._partnerRoot, target);
		const next: SessionProfile = { ...(profile ?? { name, createdAt: Date.now() }), name: target, createdAt: Date.now(), ...(mode === "fork" ? { forkedFrom: name } : {}) };
		delete next.pinned;
		/* The chat appears at once and says it is being written; the copy itself runs behind this return. */
		await mkdir(dir, { recursive: true });
		await writeProfile(dir, next);
		await markForking(dir, name);
		const job = this._fill(source, dir, next)
			.then(() => {
				this._sessions.get(target)?.invalidate();
				this._forkEmitter.fire({ session: target });
			})
			.catch(async (error: unknown) => {
				await rm(dir, { recursive: true, force: true }).catch(() => undefined);
				this._forkEmitter.fire({ session: target, error: reason(error) });
			})
			.finally(() => this._forks.delete(target));
		this._forks.set(target, job);
		return target;
	}

	private async _fill(source: Session, dir: string, profile: SessionProfile): Promise<void> {
		/* The logs are rewritten by the fork itself, so the copy leaves them out — a chat's history is
		   most of its bytes and copying it twice is the whole cost of this operation. */
		await cp(source.root, dir, { recursive: true, filter: (from) => !from.endsWith(".tmp") && !from.endsWith(".jsonl") });
		await writeProfile(dir, profile);
		await source.forkInto(dir);
		await clearForking(dir);
	}

	/** A fork that never finished is not a chat: its directory only holds half a copy. */
	private async _discardIncomplete(): Promise<void> {
		for (const name of await this._names()) {
			const dir = join(this._partnerRoot, name);
			if ((await forkingOf(dir)) === null) continue;
			await rm(dir, { recursive: true, force: true }).catch(() => undefined);
		}
	}

	async promote(name: string): Promise<void> {
		if (this.running(name)) throw new Error(`"${name}" is still running; wait for it to finish`);
		await (await this.ensure(name)).promote();
	}

	async forksOf(name: string): Promise<string[]> {
		const forks: string[] = [];
		for (const each of await this._names()) {
			const profile = await profileOf(join(this._partnerRoot, each));
			if (profile?.forkedFrom === name) forks.push(each);
		}
		return forks;
	}

	running(name: string): boolean {
		return this._sessions.get(name)?.running ?? false;
	}

	async shutdown(): Promise<void> {
		await Promise.allSettled(this._forks.values());
		for (const session of this._sessions.values()) await session.close();
	}

	async close(name: string): Promise<void> {
		const session = this._sessions.get(name);
		if (!session) return;
		this._sessions.delete(name);
		this._relays.get(name)?.dispose();
		this._relays.delete(name);
		await session.close();
	}

	dispose(): void {
		this._entryEmitter.dispose();
		this._loopEmitter.dispose();
		this._forkEmitter.dispose();
		this._compactingEmitter.dispose();
		for (const relays of this._relays.values()) relays.dispose();
		for (const session of this._sessions.values()) session.dispose();
		this._sessions.clear();
		this._relays.clear();
	}

	async slots(point: string, session?: Session | null): Promise<SlotItem[]> {
		const source = this._contributionService.get<SlotItem>(point);
		const items: SlotItem[] = [];
		for (const item of source.all()) {
			const data = await this._dataOf(item, source, session);
			if (data === null) continue;
			items.push({
				id: item.id,
				component: item.component,
				...(item.title === undefined ? {} : { title: item.title }),
				...(item.icon === undefined ? {} : { icon: item.icon }),
				...(item.order === undefined ? {} : { order: item.order }),
				...(data === undefined ? {} : { data }),
			});
		}
		return items.sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
	}

	async composer(): Promise<{ left: ComposerWidget[]; right: ComposerWidget[]; tips: ComposerTip[] }> {
		return {
			left: this._widgetsOf(COMPOSER_LEFT_POINT),
			right: this._widgetsOf(COMPOSER_RIGHT_POINT),
			tips: this._contributionService
				.get<ComposerTipItem>(COMPOSER_TIPS_POINT)
				.all()
				.map((tip) => ({
					id: tip.id,
					label: tip.label,
					...(tip.keys === undefined ? {} : { keys: tip.keys }),
					...(tip.when === undefined ? {} : { when: tip.when }),
					...(tip.order === undefined ? {} : { order: tip.order }),
				}))
				.sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)),
		};
	}

	private async _dataOf(item: SlotItem, point: ContributionPoint<SlotItem>, session: Session | null | undefined): Promise<unknown> {
		if (typeof item.data !== "function") return item.data;
		try {
			if (point.scope === "global") return await (item.data as () => unknown)();
			return session ? await (item.data as (session: Session) => unknown)(session) : undefined;
		} catch (error) {
			console.error(`slot "${item.id}" data failed:`, error);
			return null;
		}
	}

	async composerData(session: Session): Promise<Record<string, unknown>> {
		const data: Record<string, unknown> = {};
		for (const point of [COMPOSER_LEFT_POINT, COMPOSER_RIGHT_POINT]) {
			for (const item of this._contributionService.get<ComposerWidgetItem>(point).all()) {
				if (typeof item.data !== "function") continue;
				const key = composerDataKey(point, item.id);
				try {
					data[key] = await item.data(session);
				} catch (error) {
					console.error(`composer data "${key}" failed:`, error);
					data[key] = null;
				}
			}
		}
		return data;
	}

	private _widgetsOf(point: string): ComposerWidget[] {
		return this._contributionService
			.get<ComposerWidgetItem>(point)
			.all()
			.map((item) => ({
				id: item.id,
				widget: item.widget,
				...(typeof item.data === "function" || item.data === undefined ? {} : { data: item.data }),
				...(item.order === undefined ? {} : { order: item.order }),
			}))
			.sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
	}

	private async _menuOf(session: Session): Promise<ContributionItem[]> {
		const point = this._contributionService.get<SessionMenuItem>(SESSION_MENU_POINT);
		const resolved: ContributionItem[] = [];
		for (const item of point.all()) {
			const one = await this._resolveItem(item, session);
			if (one) resolved.push(one);
		}
		return resolved.sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
	}

	private async _resolveItem(item: SessionMenuItem, session: Session): Promise<ContributionItem | null> {
		const resolve = async <T>(value: SessionValue<T> | undefined): Promise<T | null | undefined> =>
			typeof value === "function" ? await (value as (session: Session) => T | null | Promise<T | null>)(session) : value;

		const title = await resolve(item.title);
		if (title === null || title === undefined) return null;
		const icon = await resolve(item.icon);
		const disabled = await resolve(item.disabled);
		const base = {
			id: item.id,
			title,
			...(typeof icon === "string" ? { icon } : {}),
			...(item.order === undefined ? {} : { order: item.order }),
			...(item.group === undefined ? {} : { group: item.group }),
			...(item.danger ? { danger: true } : {}),
			...(disabled === true ? { disabled: true } : {}),
		};

		if ("items" in item) {
			const children = (await resolve(item.items)) ?? [];
			const resolved: ContributionItem[] = [];
			for (const child of children) {
				const one = await this._resolveItem(child, session);
				if (one) resolved.push(one);
			}
			if (resolved.length === 0) return null;
			return { ...base, items: resolved };
		}

		return { ...base, action: item.action, ...(item.args === undefined ? {} : { args: item.args }) };
	}

	private async _signalsOf(session: Session): Promise<SessionSignal[]> {
		const point = this._contributionService.get<SessionSignalItem>(SESSION_SIGNAL_POINT);
		const resolved: (SessionSignal & { order: number })[] = [];
		for (const item of point.all()) {
			const title = typeof item.title === "function" ? await item.title(session) : item.title;
			if (!title) continue;
			const count = typeof item.count === "function" ? await item.count(session) : item.count;
			resolved.push({
				id: item.id,
				title,
				...(item.icon ? { icon: item.icon } : {}),
				...(typeof count === "number" ? { count } : {}),
				order: item.order ?? 0,
			});
		}
		return resolved
			.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
			.map(({ id, title, icon, count }) => ({ id, title, ...(icon ? { icon } : {}), ...(typeof count === "number" ? { count } : {}) }));
	}

	private async _rowOf(session: Session): Promise<SessionRow> {
		const [menu, signals] = await Promise.all([this._menuOf(session), this._signalsOf(session)]);
		const extra = { menu, ...(signals.length === 0 ? {} : { signals }) };
		try {
			return { ...(await session.row()), ...extra };
		} catch (error) {
			console.error(`session "${session.name}" did not open:`, error);
			const profile = await profileOf(session.root);
			return {
				name: session.name,
				path: session.path,
				storage: session.storage,
				createdAt: profile?.createdAt ?? 0,
				...(profile?.persona ? { persona: profile.persona } : {}),
				...(profile?.forkedFrom ? { forkedFrom: profile.forkedFrom } : {}),
				...(profile?.pinned ? { pinned: true } : {}),
				running: session.running,
				error: reason(error),
				...extra,
			};
		}
	}

	private async _names(): Promise<string[]> {
		const listed = await this._executionService.env(this._partnerRoot).listDir(".");
		if (!listed.ok) return [];
		return listed.value.filter((entry) => entry.kind === "directory").map((entry) => entry.name);
	}
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export const ISessionService = createServiceId<SessionService>("SessionService");
