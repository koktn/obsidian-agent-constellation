/** JSONL のパース結果(1セッション分) */
export interface ParsedSession {
	sessionId: string;
	source: "codex";
	startedAt: string | null;
	endedAt: string | null;
	cwd: string | null;
	firstUserPrompt: string | null;
	userMessages: string[];
	lastAssistantMessage: string | null;
	commands: string[];
	files: string[];
	turns: number;
}

/** 台帳(内部データ層)に保存するセッション情報 */
export interface StoredSession {
	sessionId: string;
	source: "codex";
	/** rollout JSONL の絶対パス */
	filePath: string;
	mtime: number;
	size: number;
	startedAt: string | null;
	endedAt: string | null;
	cwd: string | null;
	repo: string | null;
	title: string;
	prompt: string | null;
	/** 類似度計算の入力(ユーザー発話の連結、上限あり) */
	text: string;
	commands: string[];
	files: string[];
	turns: number;
	summary: string;
	/** Vault 相対のノートパス */
	notePath: string;
}

export type SkillStatus = "none" | "candidate" | "promoted";

export interface StoredCluster {
	clusterId: string;
	name: string;
	members: string[]; // sessionId
	skillStatus: SkillStatus;
	/** Vault 相対のハブノートパス */
	notePath: string;
}

export interface LedgerData {
	version: number;
	hostname: string;
	sessions: Record<string, StoredSession>; // sessionId -> session
	clusters: Record<string, StoredCluster>; // clusterId -> cluster
	/** ユーザー発話が無くスキップした rollout(filePath -> mtime/size)。再スキャン時の再処理を防ぐ */
	skipped: Record<string, { mtime: number; size: number }>;
}

export interface EmbeddingCache {
	version: number;
	model: string;
	/** sessionId -> { hash: 入力テキストのハッシュ, vector } */
	entries: Record<string, { hash: string; vector: number[] }>;
}

export interface Edge {
	a: string;
	b: string;
	score: number;
}
