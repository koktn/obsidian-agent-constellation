import { App, FileSystemAdapter, Notice, TFile, normalizePath } from "obsidian";
import * as os from "os";
import * as fs from "fs";
import type { ACSettings } from "../settings";
import type { ConstellationEngine } from "../engine";
import type { StoredCluster, StoredSession } from "../types";
import { renderBrief, sanitizeFileName } from "../noteRenderer";
import { runInTerminal } from "./terminal";
import { t } from "../i18n";

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
		new Notice(t("notice.clusterNotFoundRescan", { id: clusterId }));
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
	await engine.writeGeneratedNote(path, content);
	new Notice(t("notice.briefCreated", { path }));

	// 生成したブリーフを新しいタブで開く
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		await app.workspace.getLeaf(true).openFile(file);
	}
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

	await runInTerminal(settings.terminal, command, repo);
}

/** Skill 完成後、手動で promoted に更新する(設計書 §8) */
export async function markPromoted(
	engine: ConstellationEngine,
	clusterId: string
): Promise<void> {
	const cluster = engine.ledger.data.clusters[clusterId];
	if (!cluster) {
		new Notice(t("notice.clusterNotFound", { id: clusterId }));
		return;
	}
	// 全クラスタの再計算はせず、当該クラスタのハブノートだけ書き直す
	cluster.skillStatus = "promoted";
	await engine.writeClusterNote(clusterId);
	await engine.ledger.save();
	new Notice(t("notice.markedPromoted", { name: cluster.name }));
}
