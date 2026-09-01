import * as fs from "fs";
import * as path from "path";
import { claudeSessionIdFromFileName, parseClaudeSession } from "../parser/claudeParser";
import { shellQuote } from "../utils";
import type { ParsedSession } from "../types";
import type { SessionFileInfo, SessionSource } from "./SessionSource";

/**
 * Claude Code のセッションソース。
 * ~/.claude/projects/<プロジェクト>/<uuid>.jsonl を読む(設計書 §3 の拡張)。
 */
export class ClaudeCodeSource implements SessionSource {
	readonly id = "claude";

	constructor(private sessionsDir: () => string) {}

	rootAvailable(): boolean {
		return fs.existsSync(this.sessionsDir());
	}

	async listSessionFiles(): Promise<SessionFileInfo[]> {
		const root = this.sessionsDir();
		const result: SessionFileInfo[] = [];
		if (!fs.existsSync(root)) return result;
		let projects: fs.Dirent[];
		try {
			projects = await fs.promises.readdir(root, { withFileTypes: true });
		} catch {
			return result;
		}
		for (const project of projects) {
			if (!project.isDirectory()) continue;
			const dir = path.join(root, project.name);
			let entries: fs.Dirent[];
			try {
				entries = await fs.promises.readdir(dir, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const e of entries) {
				if (!e.isFile() || !claudeSessionIdFromFileName(e.name)) continue;
				const full = path.join(dir, e.name);
				try {
					const st = await fs.promises.stat(full);
					result.push({ filePath: full, mtime: st.mtimeMs, size: st.size });
				} catch {
					// stat に失敗したファイルは無視
				}
			}
		}
		return result;
	}

	async parseSessionFile(filePath: string): Promise<ParsedSession | null> {
		try {
			const content = await fs.promises.readFile(filePath, "utf8");
			return parseClaudeSession(content, path.basename(filePath));
		} catch (e) {
			console.error(`[agent-constellation] パース失敗: ${filePath}`, e);
			return null;
		}
	}

	buildResumeCommand(sessionId: string, cwd: string | null): string {
		const resume = `claude --resume ${shellQuote(sessionId)}`;
		return cwd ? `cd ${shellQuote(cwd)} && ${resume}` : resume;
	}
}
