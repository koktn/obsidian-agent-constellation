/** 対応するエージェントの種別 */
export type SessionSourceId = "codex" | "claude";

/** JSONL のパース結果(1セッション分) */
export interface ParsedSession {
	sessionId: string;
	source: SessionSourceId;
	startedAt: string | null;
	endedAt: string | null;
	cwd: string | null;
	/** ソースが持つセッションタイトル(Claude Code の ai-title 等)。無ければ null */
	title: string | null;
	firstUserPrompt: string | null;
	userMessages: string[];
	lastAssistantMessage: string | null;
	commands: string[];
	files: string[];
	turns: number;
}

/** 台帳(内部データ層)に保存するセッション情報 */
export interface StoredSession {
	/** source と sessionId を組み合わせた台帳内の一意キー */
	key: string;
	sessionId: string;
	source: SessionSourceId;
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
	lastAssistantMessage: string | null;
	summary: string;
	/** 同一ログのコピーとみなせる場合の代表セッションキー */
	duplicateOf?: string;
	/** Vault 相対のノートパス */
	notePath: string;
}

export type SkillStatus = "none" | "candidate" | "promoted";

export interface StoredCluster {
	clusterId: string;
	name: string;
	nameLocale?: "en" | "ja";
	members: string[]; // sessionId
	/** Skill候補評価期間内の、重複を除いた session key */
	recentMembers?: string[];
	/** 0 は全期間 */
	candidateWindowDays?: number;
	/** 評価期間内メンバー間の類似リンク密度 (0..1) */
	candidateDensity?: number;
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
	/** 前回計算済みの類似リンク。通常スキャンでは変更セッション分だけ更新する */
	edges: Edge[];
	edgeSignature: string;
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
