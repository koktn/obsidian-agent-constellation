import * as fs from "fs";
import * as path from "path";
import { parseRollout } from "../parser/codexParser";
import { shellQuote } from "../utils";
import type { ParsedSession } from "../types";
import type { SessionFileInfo, SessionSource } from "./SessionSource";

const ROLLOUT_RE = /^rollout-.*\.jsonl$/;

/**
 * Codex CLI のセッションソース(設計書 §3)。
 * デスクトップ版の Node API で Vault 外の ~/.codex/sessions を直接読む。
 */
export class CodexSource implements SessionSource {
	readonly id = "codex";

	constructor(private sessionsDir: () => string) {}

	async listSessionFiles(): Promise<SessionFileInfo[]> {
		const root = this.sessionsDir();
		const result: SessionFileInfo[] = [];
		if (!fs.existsSync(root)) return result;
		const walk = async (dir: string): Promise<void> => {
			let entries: fs.Dirent[];
			try {
				entries = await fs.promises.readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const e of entries) {
				const full = path.join(dir, e.name);
				if (e.isDirectory()) {
					await walk(full);
				} else if (e.isFile() && ROLLOUT_RE.test(e.name)) {
					try {
						const st = await fs.promises.stat(full);
						result.push({ filePath: full, mtime: st.mtimeMs, size: st.size });
					} catch {
						// stat に失敗したファイルは無視
					}
				}
			}
		};
		await walk(root);
		return result;
	}

	async parseSessionFile(filePath: string): Promise<ParsedSession | null> {
		try {
			const content = await fs.promises.readFile(filePath, "utf8");
			return parseRollout(content, path.basename(filePath));
		} catch (e) {
			console.error(`[agent-constellation] パース失敗: ${filePath}`, e);
			return null;
		}
	}

	buildResumeCommand(sessionId: string, cwd: string | null): string {
		const resume = `codex resume ${sessionId}`;
		return cwd ? `cd ${shellQuote(cwd)} && ${resume}` : resume;
	}
}

/** cwd から Git リポジトリ名を検出する(.git を上方向に探索) */
export function detectRepo(cwd: string | null): string | null {
	if (!cwd) return null;
	try {
		let dir = cwd;
		for (let i = 0; i < 20; i++) {
			if (fs.existsSync(path.join(dir, ".git"))) {
				return path.basename(dir);
			}
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	} catch {
		// アクセス不可などは無視
	}
	return null;
}
