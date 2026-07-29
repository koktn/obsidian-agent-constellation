import { App, Notice, TFile, normalizePath } from "obsidian";
import * as os from "os";
import type { ACSettings } from "./settings";
import type {
	Edge,
	ParsedSession,
	StoredCluster,
	StoredSession,
} from "./types";
import { Ledger } from "./ledger";
import { CodexSource, detectRepo } from "./sources/CodexSource";
import { ClaudeCodeSource } from "./sources/ClaudeCodeSource";
import type { SessionFileInfo, SessionSource } from "./sources/SessionSource";
import { TfidfModel, extractKeywords } from "./similarity/tfidf";
import { combineScore, cosine, l1Score } from "./similarity/similarity";
import { clusterize, matchClusterIds } from "./similarity/cluster";
import { OllamaClient } from "./ollama";
import {
	dateStrOf,
	makeSummary,
	makeTitle,
	noteBasename,
	renderClusterNote,
	renderSessionNote,
	sanitizeFileName,
	sanitizeTag,
	summarizeCommonPatterns,
} from "./noteRenderer";
import { hashText, yieldEvery } from "./utils";
import { t } from "./i18n";

const MAX_SIMILARITY_TEXT = 8000;
const PROMPT_SEPARATOR = "\n\n---\n\n";
const GENERATED_RE = /^---[\s\S]*?\bgenerated:\s*true\b[\s\S]*?\n---/;

export class ConstellationEngine {
	sources: SessionSource[];
	private scanning = false;

	constructor(
		private app: App,
		private getSettings: () => ACSettings,
		public ledger: Ledger,
		codexSessionsDir: () => string,
		claudeSessionsDir: () => string,
		private saveSettings: () => Promise<void>
	) {
		this.sources = [
			new CodexSource(codexSessionsDir),
			new ClaudeCodeSource(claudeSessionsDir),
		];
	}

	/** セッションの取り込み元ソース。source 不明時は codex(後方互換) */
	sourceOf(sourceId: string | null | undefined): SessionSource {
		return this.sources.find((s) => s.id === sourceId) ?? this.sources[0];
	}

	buildResumeCommand(
		sourceId: string | null | undefined,
		sessionId: string,
		cwd: string | null
	): string {
		return this.sourceOf(sourceId).buildResumeCommand(sessionId, cwd);
	}

	private get settings(): ACSettings {
		return this.getSettings();
	}

	hostname(): string {
		return os.hostname();
	}

	/** 取り込み担当マシンか(設計書 §12)。未設定なら担当を名乗る */
	isImportHost(): { ok: boolean; adopted: boolean } {
		const s = this.settings;
		if (!s.importHostname) {
			s.importHostname = this.hostname();
			return { ok: true, adopted: true };
		}
		return { ok: s.importHostname === this.hostname(), adopted: false };
	}

	// ---------- スキャン(M1/M4) ----------

	async scan(opts: { silent?: boolean; rebuildAll?: boolean } = {}): Promise<void> {
		if (this.scanning) return;
		this.scanning = true;
		// 失敗時に台帳を巻き戻すためのスナップショット。
		// 途中まで更新した台帳が残ると、次回スキャンで「変更なし」と誤判定され
		// ノートが永久に書かれないため、失敗時は必ず元に戻す。
		const snapshot = JSON.stringify(this.ledger.data);
		try {
			await this.scanInner(opts);
		} catch (e) {
			try {
				this.ledger.data = JSON.parse(snapshot);
			} catch {
				// スナップショット復元に失敗しても続行(次回 rebuildAll で回復可能)
			}
			console.error("[agent-constellation] スキャン失敗", e);
			new Notice(
				t("notice.scanFailed", { msg: e instanceof Error ? e.message : String(e) })
			);
		} finally {
			this.scanning = false;
		}
	}

	private async scanInner(opts: { silent?: boolean; rebuildAll?: boolean }): Promise<void> {
		const lock = this.isImportHost();
		if (lock.adopted) await this.saveSettings();
		if (!lock.ok) {
			if (!opts.silent) {
				new Notice(
					t("notice.notImportHost", { host: this.settings.importHostname })
				);
			}
			return;
		}

		const files: { src: SessionSource; f: SessionFileInfo }[] = [];
		for (const src of this.sources) {
			for (const f of await src.listSessionFiles()) files.push({ src, f });
		}
		const byPath = new Map<string, StoredSession>();
		for (const s of Object.values(this.ledger.data.sessions)) {
			byPath.set(s.filePath, s);
		}
		const skipped = this.ledger.data.skipped;

		const changed = opts.rebuildAll
			? files
			: files.filter(({ f }) => {
					const prev = byPath.get(f.filePath);
					if (prev) return prev.mtime !== f.mtime || prev.size !== f.size;
					const sk = skipped[f.filePath];
					return !sk || sk.mtime !== f.mtime || sk.size !== f.size;
				});

		if (changed.length === 0 && !opts.rebuildAll) {
			if (!opts.silent) new Notice(t("notice.noNewSessions"));
			return;
		}

		const progress = opts.silent
			? null
			: new Notice(t("notice.importing", { n: 0, total: changed.length }), 0);
		const counter = { n: 0 };
		let imported = 0;
		try {
			for (const { src, f } of changed) {
				const parsed = await src.parseSessionFile(f.filePath);
				if (parsed && parsed.userMessages.length > 0) {
					delete skipped[f.filePath];
					this.storeSession(parsed, f.filePath, f.mtime, f.size);
					imported++;
				} else {
					// ユーザー発話が無いセッションはノート化しない(空セッション同士の偽クラスタ防止)
					skipped[f.filePath] = { mtime: f.mtime, size: f.size };
					if (parsed) await this.dropSession(parsed.sessionId);
				}
				if (progress && imported % 10 === 0) {
					progress.setMessage(
						t("notice.importing", { n: imported, total: changed.length })
					);
				}
				await yieldEvery(counter, 5);
			}

			if (progress) progress.setMessage(t("notice.computing"));
			await this.recomputeAndWrite();
			await this.ledger.save();
		} finally {
			progress?.hide();
		}
		if (!opts.silent) {
			new Notice(
				t("notice.imported", {
					n: imported,
					total: Object.keys(this.ledger.data.sessions).length,
				})
			);
		}
	}

	/** 以前取り込んだセッションを台帳・ノート・キャッシュから取り除く */
	private async dropSession(sessionId: string): Promise<void> {
		const prev = this.ledger.data.sessions[sessionId];
		if (!prev) return;
		await this.removeGeneratedNote(prev.notePath);
		delete this.ledger.data.sessions[sessionId];
		delete this.ledger.embeddings.entries[sessionId];
	}

	private storeSession(
		p: ParsedSession,
		filePath: string,
		mtime: number,
		size: number
	): void {
		const prev = this.ledger.data.sessions[p.sessionId];
		const repo = detectRepo(p.cwd) ?? (p.cwd ? p.cwd.split("/").pop() ?? null : null);
		// ソースがタイトルを持つ場合(Claude Code の ai-title)はそれを優先
		const title = makeTitle(p.title ?? p.firstUserPrompt, p.sessionId);
		const text = p.userMessages.join(PROMPT_SEPARATOR).slice(0, MAX_SIMILARITY_TEXT);
		const stored: StoredSession = {
			sessionId: p.sessionId,
			source: p.source,
			filePath,
			mtime,
			size,
			startedAt: p.startedAt,
			endedAt: p.endedAt,
			cwd: p.cwd,
			repo,
			title,
			prompt: p.firstUserPrompt,
			text,
			commands: p.commands,
			files: p.files,
			turns: p.turns,
			summary: makeSummary(p.firstUserPrompt, p.lastAssistantMessage),
			notePath: prev?.notePath ?? this.buildNotePath(p, title),
		};
		this.ledger.data.sessions[p.sessionId] = stored;
	}

	private buildNotePath(p: ParsedSession, title: string): string {
		const folder = `${this.settings.noteFolder}/sessions`;
		const base = sanitizeFileName(`${dateStrOf(p.startedAt)} ${title}`);
		let candidate = normalizePath(`${folder}/${base}.md`);
		const taken = new Set(
			Object.values(this.ledger.data.sessions)
				.filter((s) => s.sessionId !== p.sessionId)
				.map((s) => s.notePath)
		);
		if (taken.has(candidate)) {
			candidate = normalizePath(`${folder}/${base} (${p.sessionId.slice(0, 8)}).md`);
		}
		return candidate;
	}

	// ---------- 類似度・クラスタ(M2/M5) ----------

	private async semanticSimilarity(
		sessions: StoredSession[]
	): Promise<(a: string, b: string) => number> {
		const s = this.settings;
		if (s.similarityLevel === "l3") {
			const fn = await this.embeddingSimilarity(sessions);
			if (fn) return fn;
			new Notice(t("notice.ollamaFallback"));
		}
		const docs = new Map(sessions.map((x) => [x.sessionId, x.text || x.title]));
		const model = new TfidfModel(docs);
		return (a, b) => model.similarity(a, b);
	}

	private async embeddingSimilarity(
		sessions: StoredSession[]
	): Promise<((a: string, b: string) => number) | null> {
		const s = this.settings;
		const client = new OllamaClient(s.ollamaEndpoint);
		if (!(await client.available())) return null;

		const cache = this.ledger.embeddings;
		if (cache.model !== s.ollamaEmbedModel) {
			cache.model = s.ollamaEmbedModel;
			cache.entries = {};
		}
		const missing = sessions.filter((x) => {
			const e = cache.entries[x.sessionId];
			return !e || e.hash !== hashText(x.text || x.title);
		});
		try {
			const BATCH = 16;
			for (let i = 0; i < missing.length; i += BATCH) {
				const batch = missing.slice(i, i + BATCH);
				const vectors = await client.embed(
					s.ollamaEmbedModel,
					batch.map((x) => (x.text || x.title).slice(0, 4000))
				);
				batch.forEach((x, j) => {
					cache.entries[x.sessionId] = {
						hash: hashText(x.text || x.title),
						vector: vectors[j],
					};
				});
			}
			await this.ledger.saveEmbeddings();
		} catch (e) {
			console.error("[agent-constellation] embedding 取得失敗", e);
			return null;
		}
		return (a, b) => {
			const va = cache.entries[a]?.vector;
			const vb = cache.entries[b]?.vector;
			if (!va || !vb) return 0;
			return cosine(va, vb);
		};
	}

	/** 類似度→リンク→クラスタ→ノート生成までの一括再計算 */
	async recomputeAndWrite(): Promise<void> {
		const s = this.settings;
		const sessions = Object.values(this.ledger.data.sessions);
		if (sessions.length === 0) return;

		const sem = await this.semanticSimilarity(sessions);
		const counter = { n: 0 };
		const edges: Edge[] = [];
		for (let i = 0; i < sessions.length; i++) {
			for (let j = i + 1; j < sessions.length; j++) {
				const a = sessions[i];
				const b = sessions[j];
				const score = combineScore(l1Score(a, b), sem(a.sessionId, b.sessionId));
				if (score >= s.linkThreshold) {
					edges.push({ a: a.sessionId, b: b.sessionId, score });
				}
			}
			await yieldEvery(counter, 10);
		}

		// クラスタリングとID引き継ぎ
		const ids = sessions.map((x) => x.sessionId);
		const groups = clusterize(ids, edges, s.linkThreshold, s.maxClusterSize);
		const oldClusters: Record<string, string[]> = {};
		for (const [id, c] of Object.entries(this.ledger.data.clusters)) {
			oldClusters[id] = c.members;
		}
		const matched = matchClusterIds(groups, oldClusters);

		const sessionById = new Map(sessions.map((x) => [x.sessionId, x]));
		const newClusters: Record<string, StoredCluster> = {};
		const usedIds = new Set<string>();
		for (let i = 0; i < groups.length; i++) {
			const members = groups[i];
			const prevId = matched[i];
			const prev = prevId ? this.ledger.data.clusters[prevId] : undefined;
			const memberSessions = members
				.map((m) => sessionById.get(m))
				.filter((x): x is StoredSession => !!x);

			let clusterId = prevId ?? (await this.nameCluster(memberSessions));
			clusterId = this.uniqueClusterId(clusterId, usedIds);
			usedIds.add(clusterId);

			const candidate = members.length >= s.skillCandidateThreshold;
			const skillStatus =
				prev?.skillStatus === "promoted"
					? "promoted"
					: candidate
						? "candidate"
						: "none";

			newClusters[clusterId] = {
				clusterId,
				name: prev?.name ?? clusterId,
				members,
				skillStatus,
				notePath: normalizePath(
					`${s.noteFolder}/clusters/${sanitizeFileName(`cluster - ${prev?.name ?? clusterId}`)}.md`
				),
			};
		}

		// 消えたクラスタ・パスが変わったハブの掃除
		const newPaths = new Set(Object.values(newClusters).map((c) => c.notePath));
		for (const old of Object.values(this.ledger.data.clusters)) {
			if (!newPaths.has(old.notePath)) {
				await this.removeGeneratedNote(old.notePath);
			}
		}
		this.ledger.data.clusters = newClusters;

		await this.writeAllNotes(edges, sessions, newClusters);
	}

	private uniqueClusterId(base: string, used: Set<string>): string {
		let id = sanitizeTag(base) || "cluster";
		let candidate = id;
		let i = 2;
		while (used.has(candidate)) {
			candidate = `${id}-${i++}`;
		}
		return candidate;
	}

	private async nameCluster(members: StoredSession[]): Promise<string> {
		const s = this.settings;
		const prompts = members.map((m) => m.prompt ?? m.title).filter((p) => p.length > 0);
		if (s.similarityLevel === "l3" || s.ollamaChatModel) {
			const client = new OllamaClient(s.ollamaEndpoint);
			if (await client.available()) {
				const name = await client.nameCluster(s.ollamaChatModel, prompts);
				if (name) return name;
			}
		}
		const keywords = extractKeywords(prompts, 3);
		if (keywords.length > 0) return keywords.join("-");
		return (members[0]?.title ?? "cluster").slice(0, 12);
	}

	// ---------- ノート書き出し ----------

	private async writeAllNotes(
		edges: Edge[],
		sessions: StoredSession[],
		clusters: Record<string, StoredCluster>
	): Promise<void> {
		const s = this.settings;
		await this.ensureFolder(`${s.noteFolder}/sessions`);
		await this.ensureFolder(`${s.noteFolder}/clusters`);

		// セッション → クラスタの逆引き
		const clusterOf = new Map<string, StoredCluster>();
		for (const c of Object.values(clusters)) {
			for (const m of c.members) clusterOf.set(m, c);
		}

		// セッションごとの関連リンク(スコア上位)
		const neighbors = new Map<string, { id: string; score: number }[]>();
		for (const e of edges) {
			(neighbors.get(e.a) ?? neighbors.set(e.a, []).get(e.a)!).push({
				id: e.b,
				score: e.score,
			});
			(neighbors.get(e.b) ?? neighbors.set(e.b, []).get(e.b)!).push({
				id: e.a,
				score: e.score,
			});
		}

		const sessionById = new Map(sessions.map((x) => [x.sessionId, x]));
		const counter = { n: 0 };
		for (const session of sessions) {
			const rel = (neighbors.get(session.sessionId) ?? [])
				.sort((a, b) => b.score - a.score)
				.slice(0, s.maxLinksPerNote)
				.map((n) => sessionById.get(n.id))
				.filter((x): x is StoredSession => !!x)
				.map((x) => ({ noteBasename: noteBasename(x.notePath) }));
			const cluster = clusterOf.get(session.sessionId) ?? null;
			const content = renderSessionNote(
				session,
				rel,
				cluster ? { clusterId: cluster.clusterId, notePath: cluster.notePath } : null
			);
			await this.writeGeneratedNote(session.notePath, content);
			await yieldEvery(counter, 10);
		}

		for (const cluster of Object.values(clusters)) {
			const memberSessions = cluster.members
				.map((m) => sessionById.get(m))
				.filter((x): x is StoredSession => !!x);
			const pattern = await this.clusterPattern(memberSessions);
			const content = renderClusterNote(cluster, memberSessions, pattern);
			await this.writeGeneratedNote(cluster.notePath, content);
		}
	}

	async clusterPattern(memberSessions: StoredSession[]): Promise<string> {
		const s = this.settings;
		const fallback = summarizeCommonPatterns(memberSessions);
		const client = new OllamaClient(s.ollamaEndpoint);
		if (s.ollamaChatModel && (await client.available())) {
			const described = await client.describeCluster(
				s.ollamaChatModel,
				memberSessions.map((m) => m.prompt ?? m.title),
				memberSessions.flatMap((m) => m.commands.slice(0, 5))
			);
			if (described) {
				return described + (fallback ? "\n\n" + fallback : "");
			}
		}
		return fallback;
	}

	/** 単一クラスタのハブノートだけを書き直す(promoted 更新用。全再計算はしない) */
	async writeClusterNote(clusterId: string): Promise<void> {
		const cluster = this.ledger.data.clusters[clusterId];
		if (!cluster) return;
		const sessions = cluster.members
			.map((m) => this.ledger.data.sessions[m])
			.filter((x): x is StoredSession => !!x);
		const pattern = await this.clusterPattern(sessions);
		await this.writeGeneratedNote(
			cluster.notePath,
			renderClusterNote(cluster, sessions, pattern)
		);
	}

	async ensureFolder(folder: string): Promise<void> {
		const parts = normalizePath(folder).split("/");
		let cur = "";
		for (const p of parts) {
			cur = cur ? `${cur}/${p}` : p;
			if (!this.app.vault.getAbstractFileByPath(cur)) {
				try {
					await this.app.vault.createFolder(cur);
				} catch {
					// 併走で作成済みなら無視
				}
			}
		}
	}

	/**
	 * generated: true のノートだけを上書きする(設計書 §5.1)。
	 * adapter 直書きだと Obsidian の索引(metadataCache)と実ファイルがずれるため、
	 * 必ず Vault API(create/modify)経由で書く。
	 */
	async writeGeneratedNote(path: string, content: string): Promise<void> {
		const normalized = normalizePath(path);
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFile) {
			const current = await this.app.vault.read(existing);
			if (!GENERATED_RE.test(current)) return; // ユーザーが管理下に置いたノート
			if (current === content) return;
			await this.app.vault.modify(existing, content);
			return;
		}
		if (existing) return; // 同名のフォルダ等がある場合は触らない
		await this.app.vault.create(normalized, content);
	}

	private async removeGeneratedNote(path: string): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
			if (!(file instanceof TFile)) return;
			const existing = await this.app.vault.read(file);
			if (!GENERATED_RE.test(existing)) return;
			await this.app.fileManager.trashFile(file);
		} catch (e) {
			console.error(`[agent-constellation] ノート削除に失敗: ${path}`, e);
		}
	}
}
