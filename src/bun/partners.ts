/**
 * Partner 管理:设置(~/.config/.partner)与 Partner 档案
 * (~/.partner/<name>/profile.json,路径可配置)。
 */
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ————— 设置 —————
export interface Settings {
	/** Partner 档案保存根目录(创建 partner 时的地址)。 */
	partner_profile_path: string;
}

const DEFAULT_SETTINGS: Settings = {
	partner_profile_path: "~/.partner/",
};

const SETTINGS_PATH = join(homedir(), ".config", ".partner");

/** 展开开头的 ~ 为用户主目录。 */
function expandHome(path: string): string {
	return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

export async function loadSettings(): Promise<Settings> {
	try {
		const parsed = JSON.parse(await readFile(SETTINGS_PATH, "utf8")) as Partial<Settings>;
		return { ...DEFAULT_SETTINGS, ...parsed };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export async function saveSettings(settings: Settings): Promise<void> {
	await mkdir(join(homedir(), ".config"), { recursive: true });
	await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

// ————— Partner 档案 —————
export interface PartnerProfile {
	name: string;
	avatar?: string;
	/** 角色短语(如 "Front-End Programmer"),必填。 */
	role?: string;
	/** 职责(用户填写,无默认)。 */
	responsibilities?: string;
	/** 语气(用户填写,无默认)。 */
	tones?: string;
	createdAt: number;
}

export interface PartnerInput {
	name: string;
	avatar?: string;
	/** 角色短语(如 "Front-End Programmer"),必填。 */
	role: string;
	responsibilities?: string;
	tones?: string;
}

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export class PartnerError extends Error {}

/** 校验 partner 名称:必填、仅字母数字/下划线/连字符。 */
function validateName(name: string): void {
	if (!name || !NAME_PATTERN.test(name)) {
		throw new PartnerError("Name is required (letters, digits, '_', '-', max 64)");
	}
}

/** 校验 role:必填(角色短语,如 "Front-End Programmer")。 */
function validateRole(role: string): void {
	if (!role?.trim()) {
		throw new PartnerError("Role is required (e.g. Front-End Programmer)");
	}
}

export function partnerRoot(settings: Settings): string {
	return expandHome(settings.partner_profile_path);
}

export function partnerDir(settings: Settings, name: string): string {
	return join(partnerRoot(settings), name);
}

/** 创建 partner:在 <root>/<name>/ 下建文件夹并写入 profile.json。 */
export async function createPartner(settings: Settings, input: PartnerInput): Promise<PartnerProfile> {
	const name = input.name.trim();
	validateName(name);
	validateRole(input.role);
	const profile: PartnerProfile = {
		name,
		avatar: input.avatar?.trim() || undefined,
		role: input.role.trim(),
		responsibilities: input.responsibilities?.trim() || undefined,
		tones: input.tones?.trim() || undefined,
		createdAt: Date.now(),
	};
	const dir = partnerDir(settings, name);
	const profilePath = join(dir, "profile.json");
	try {
		await access(profilePath);
		throw new PartnerError(`Partner "${name}" already exists`);
	} catch (error) {
		if (error instanceof PartnerError) throw error;
		// 目录/文件不存在 → 正常创建
	}
	await mkdir(dir, { recursive: true });
	await writeFile(profilePath, JSON.stringify(profile, null, 2) + "\n", "utf8");
	return profile;
}

/** 删除 partner:移除 <root>/<name>/ 目录(名称先过校验,防路径穿越)。 */
export async function deletePartner(settings: Settings, name: string): Promise<void> {
	const trimmed = name.trim();
	validateName(trimmed);
	await rm(partnerDir(settings, trimmed), { recursive: true, force: true });
}

/** 列出所有 partner(按创建时间排序)。 */
export async function listPartners(settings: Settings): Promise<PartnerProfile[]> {
	let entries;
	try {
		entries = await readdir(partnerRoot(settings), { withFileTypes: true });
	} catch {
		return [];
	}
	const profiles: PartnerProfile[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		try {
			const profile = JSON.parse(await readFile(join(partnerRoot(settings), entry.name, "profile.json"), "utf8")) as PartnerProfile;
			profiles.push(profile);
		} catch {
			// 无 profile.json 的目录忽略
		}
	}
	return profiles.sort((a, b) => a.createdAt - b.createdAt);
}
