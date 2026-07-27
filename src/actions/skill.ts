import { App, FileSystemAdapter, Notice, normalizePath } from "obsidian";
import * as os from "os";
import * as fs from "fs";
import type { ACSettings } from "../settings";
import type { ConstellationEngine } from "../engine";
import type { StoredCluster, StoredSession } from "../types";
import { renderBrief, sanitizeFileName } from "../noteRenderer";
import { runInTerminal } from "./terminal";

/**
 * Skill 化フロー(設計書 §8)。
 * Skill の作成自体は Codex CLI(skill-creator)が担い、本プラグインは
 * クラスタブリーフの生成と Codex への受け渡しまでを行う。
 */

function getCluster(
	engine: ConstellationEngine,
	clusterId: string
): { cluster: StoredCluster; sessions: StoredSession[] } | null {
	const cluster = engine.ledger.data.clusters[clusterId];
	if (!cluster) {
		new Notice(`クラスタ ${clusterId} が見つかりません。再スキャンしてください。`);
		return null;
	}
	const sessions = cluster.members
		.map((m) => engine.ledger.data.sessions[m])
		.filter((s): s is StoredSession => !!s);
	return { cluster, sessions };
}

/** クラスタブリーフを生成し、Vault 相対パスを返す */
export async function generateBrief(
	app: App,
	settings: ACSettings,
	engine: ConstellationEngine,
	clusterId: string
): Promise<string | null> {
	const found = getCluster(engine, clusterId);
	if (!found) return null;
	const { cluster, sessions } = found;

	const pattern = await engine.clusterPattern(sessions);
	const content = renderBrief(cluster, sessions, pattern);
	const folder = `${settings.noteFolder}/skills`;
	await engine.ensureFolder(folder);
	const path = normalizePath(
		`${folder}/${sanitizeFileName(`brief - ${cluster.name}`)}.md`
	);
	await app.vault.adapter.write(path, content);
	new Notice(`ブリーフを生成しました: ${path}`);
	return path;
}

/** ブリーフを生成して Codex(skill-creator)に渡す */
export async function promoteWithCodex(
	app: App,
	settings: ACSettings,
	engine: ConstellationEngine,
	clusterId: string
): Promise<void> {
	const found = getCluster(engine, clusterId);
	if (!found) return;
	const { sessions } = found;

	const briefPath = await generateBrief(app, settings, engine, clusterId);
	if (!briefPath) return;

	const adapter = app.vault.adapter;
	const briefAbs =
		adapter instanceof FileSystemAdapter ? adapter.getFullPath(briefPath) : briefPath;

	// 対象ディレクトリ: クラスタ内で最多の cwd(存在するもの)、無ければホーム
	const cwdFreq = new Map<string, number>();
	for (const s of sessions) {
		if (s.cwd) cwdFreq.set(s.cwd, (cwdFreq.get(s.cwd) ?? 0) + 1);
	}
	const repo =
		[...cwdFreq.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([dir]) => dir)
			.find((dir) => fs.existsSync(dir)) ?? os.homedir();

	const command = settings.skillCommandTemplate
		.replace(/\{repo\}/g, repo)
		.replace(/\{brief\}/g, briefAbs);

	await runInTerminal(settings.terminal, command);
}

/** Skill 完成後、手動で promoted に更新する(設計書 §8) */
export async function markPromoted(
	engine: ConstellationEngine,
	clusterId: string
): Promise<void> {
	const cluster = engine.ledger.data.clusters[clusterId];
	if (!cluster) {
		new Notice(`クラスタ ${clusterId} が見つかりません。`);
		return;
	}
	cluster.skillStatus = "promoted";
	await engine.recomputeAndWrite();
	await engine.ledger.save();
	new Notice(`クラスタ「${cluster.name}」を promoted にしました。`);
}
