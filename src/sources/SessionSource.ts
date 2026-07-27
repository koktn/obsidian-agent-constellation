import type { ParsedSession } from "../types";

export interface SessionFileInfo {
	/** セッション実体ファイルの絶対パス */
	filePath: string;
	mtime: number;
	size: number;
}

/**
 * エージェントのセッション履歴の供給元(設計書 §3)。
 * まず Codex CLI に対応し、将来他のエージェントを追加できるようにする。
 */
export interface SessionSource {
	readonly id: string;
	/** セッションファイルを列挙する */
	listSessionFiles(): Promise<SessionFileInfo[]>;
	/** 1ファイルをパースする(解釈不能なら null) */
	parseSessionFile(filePath: string): Promise<ParsedSession | null>;
	/** resume コマンドを組み立てる */
	buildResumeCommand(sessionId: string, cwd: string | null): string;
}
