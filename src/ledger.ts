import type { DataAdapter } from "obsidian";
import type { EmbeddingCache, LedgerData } from "./types";

const LEDGER_VERSION = 2;

/**
 * 内部データ層(設計書 §2.2)。
 * `.obsidian/plugins/agent-constellation/data/` に取り込み台帳と
 * embedding キャッシュを保存する。同期環境での衝突を避けるため
 * ファイル名にホスト名を含める(設計書 §12)。
 */
export class Ledger {
	data: LedgerData;
	embeddings: EmbeddingCache;

	private dir: string;

	constructor(
		private adapter: DataAdapter,
		private hostname: string,
		configDir: string,
	) {
		this.dir = `${configDir}/plugins/agent-constellation/data`;
		this.data = {
			version: LEDGER_VERSION,
			hostname,
			sessions: {},
			clusters: {},
			skipped: {},
			edges: [],
			edgeSignature: "",
		};
		this.embeddings = { version: LEDGER_VERSION, model: "", entries: {} };
	}

	private sanitizeHost(): string {
		return this.hostname.replace(/[^A-Za-z0-9._-]/g, "_");
	}

	private ledgerPath(): string {
		return `${this.dir}/index-${this.sanitizeHost()}.json`;
	}

	private embeddingsPath(): string {
		return `${this.dir}/embeddings-${this.sanitizeHost()}.json`;
	}

	async load(): Promise<void> {
		try {
			if (await this.adapter.exists(this.ledgerPath())) {
				const raw = await this.adapter.read(this.ledgerPath());
				const parsed = JSON.parse(raw) as LedgerData;
				if (parsed && parsed.sessions && parsed.clusters) {
					this.data = parsed;
					this.data.hostname = this.hostname;
					if (!this.data.skipped) this.data.skipped = {};
					if (!this.data.edges) this.data.edges = [];
					if (!this.data.edgeSignature) this.data.edgeSignature = "";
					this.migrateSessionKeys();
				}
			}
		} catch (e) {
			console.error("[agent-constellation] 台帳の読み込みに失敗しました", e);
		}
		try {
			if (await this.adapter.exists(this.embeddingsPath())) {
				const raw = await this.adapter.read(this.embeddingsPath());
				const parsed = JSON.parse(raw) as EmbeddingCache;
				if (parsed && parsed.entries) this.embeddings = parsed;
			}
		} catch (e) {
			console.error("[agent-constellation] embeddingキャッシュの読み込みに失敗しました", e);
		}
		this.migrateEmbeddingKeys();
	}

	/** v1 の sessionId 単独キーを source:sessionId へ移行する。 */
	private migrateSessionKeys(): void {
		const oldSessions = this.data.sessions as Record<string, import("./types").StoredSession>;
		const next: Record<string, import("./types").StoredSession> = {};
		const idToKeys = new Map<string, string[]>();
		for (const [oldKey, session] of Object.entries(oldSessions)) {
			const key =
				session.key || `${session.source ?? "codex"}:${session.sessionId || oldKey}`;
			session.key = key;
			const legacy = session as import("./types").StoredSession & {
				lastAssistantMessage?: string | null;
			};
			if (legacy.lastAssistantMessage === undefined) session.lastAssistantMessage = null;
			next[key] = session;
			const keys = idToKeys.get(session.sessionId) ?? [];
			keys.push(key);
			idToKeys.set(session.sessionId, keys);
		}
		this.data.sessions = next;
		for (const cluster of Object.values(this.data.clusters)) {
			cluster.members = cluster.members
				.map((member) => (next[member] ? member : idToKeys.get(member)?.[0]))
				.filter((member): member is string => !!member);
			if (cluster.recentMembers) {
				cluster.recentMembers = cluster.recentMembers
					.map((member) => (next[member] ? member : idToKeys.get(member)?.[0]))
					.filter((member): member is string => !!member);
			}
		}
		this.data.version = LEDGER_VERSION;
	}

	private migrateEmbeddingKeys(): void {
		const next: EmbeddingCache["entries"] = {};
		for (const [oldKey, entry] of Object.entries(this.embeddings.entries)) {
			if (this.data.sessions[oldKey]) {
				next[oldKey] = entry;
				continue;
			}
			const matches = Object.values(this.data.sessions).filter((s) => s.sessionId === oldKey);
			for (const session of matches) next[session.key] = entry;
		}
		this.embeddings.entries = next;
		this.embeddings.version = LEDGER_VERSION;
	}

	private async ensureDir(): Promise<void> {
		const parts = this.dir.split("/");
		let cur = "";
		for (const p of parts) {
			cur = cur ? `${cur}/${p}` : p;
			if (!(await this.adapter.exists(cur))) {
				await this.adapter.mkdir(cur);
			}
		}
	}

	async save(): Promise<void> {
		await this.ensureDir();
		await this.adapter.write(this.ledgerPath(), JSON.stringify(this.data));
	}

	async saveEmbeddings(): Promise<void> {
		await this.ensureDir();
		await this.adapter.write(this.embeddingsPath(), JSON.stringify(this.embeddings));
	}
}
