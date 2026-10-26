import { join } from "node:path";

import { createServiceId, DisposableStore, Emitter, type Event, type Service } from "@milu/di";
import type { ComposerTip, ComposerWidget, ContributionItem, SeqEntry, SessionRow, SlotItem } from "@milu/protocol";

import {
	COMPOSER_LEFT_POINT,
	COMPOSER_RIGHT_POINT,
	COMPOSER_TIPS_POINT,
	type ComposerTipItem,
	type ComposerWidgetItem,
	SESSION_MENU_POINT,
	type SessionMenuItem,
	type SessionValue,
} from "../extensions/types.ts";
import { profileOf } from "../session/files.ts";
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

export class SessionService implements Service {
	readonly onEntry: Event<SessionEntry>;
	readonly onLoopEvent: Event<SessionLoopEvent>;

	private _partnerRoot = "";
	private readonly _sessions = new Map<string, Session>();
	private readonly _relays = new Map<string, DisposableStore>();
	private readonly _entryEmitter = new Emitter<SessionEntry>();
	private readonly _loopEmitter = new Emitter<SessionLoopEvent>();

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
	}

	async initialize(): Promise<void> {
		this._partnerRoot = expandHome(this._settingsService.get().partner_profile_path);
	}

	get partnerRoot(): string {
		return this._partnerRoot;
	}

	async list(): Promise<readonly SessionRow[]> {
		const rows: SessionRow[] = [];
		for (const name of await this._names()) {
			rows.push(await this._rowOf(this.get(name)));
		}
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
		});
		this._sessions.set(name, session);

		const relays = new DisposableStore();
		relays.add(session.onEntry((entry) => this._entryEmitter.fire({ session: name, entry })));
		relays.add(session.onLoopEvent((event) => this._loopEmitter.fire({ session: name, event })));
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
			items.push({ id: item.id, component: item.component, ...(item.order === undefined ? {} : { order: item.order }), ...(data === undefined ? {} : { data }) });
		}
		return items.sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
	}

	async composer(session: Session): Promise<{ left: ComposerWidget[]; right: ComposerWidget[]; tips: ComposerTip[] }> {
		return {
			left: await this._widgetsOf(COMPOSER_LEFT_POINT, session),
			right: await this._widgetsOf(COMPOSER_RIGHT_POINT, session),
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

	private async _widgetsOf(point: string, session: Session): Promise<ComposerWidget[]> {
		const resolved: ComposerWidget[] = [];
		for (const item of this._contributionService.get<ComposerWidgetItem>(point).all()) {
			const data = typeof item.data === "function" ? await (item.data as (session: Session) => unknown)(session) : item.data;
			if (data === null) continue;
			resolved.push({ id: item.id, widget: item.widget, ...(data === undefined ? {} : { data }), ...(item.order === undefined ? {} : { order: item.order }) });
		}
		return resolved.sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
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
		const base = {
			id: item.id,
			title,
			...(typeof icon === "string" ? { icon } : {}),
			...(item.order === undefined ? {} : { order: item.order }),
			...(item.group === undefined ? {} : { group: item.group }),
			...(item.danger ? { danger: true } : {}),
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

	private async _rowOf(session: Session): Promise<SessionRow> {
		const menu = await this._menuOf(session);
		try {
			return { ...(await session.row()), menu };
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
				menu,
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
