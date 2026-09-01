import type { ParsedSession } from "../types";
import {
	MAX_COMMANDS,
	MAX_FILES,
	MAX_TEXT_PER_MESSAGE,
	CappedSet,
	asString,
	normalizeCommand,
	relativizeFiles,
} from "./common";

/**
 * Claude Code のセッション JSONL(~/.claude/projects/<プロジェクト>/<uuid>.jsonl)パーサ。
 * Codex 同様スキーマは非公式のため防御的に扱い、未知のエントリは無視する(設計書 §12)。
 */

const FILE_NAME_RE =
	/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** 変更ファイルとして扱うツール(Read 等の参照系は含めない) */
const FILE_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function claudeSessionIdFromFileName(fileName: string): string | null {
	const m = FILE_NAME_RE.exec(fileName);
	return m ? m[1].toLowerCase() : null;
}

/**
 * Claude Code は user エントリとして tool_result・タスク通知・
 * ローカルコマンド実行ログ(<command-name> / Caveat: ...)なども記録するため、
 * 本物のユーザー発話だけを残す。
 */
function isRealUserText(text: string): boolean {
	const t = text.trim();
	if (t.length === 0) return false;
	if (t.startsWith("<")) return false;
	if (t.startsWith("Caveat:")) return false;
	if (t.startsWith("[Request interrupted")) return false;
	if (/^\[Image[:#\]]/.test(t)) return false;
	return true;
}

/** message.content(文字列 / ブロック配列)からユーザー発話テキストを取り出す */
function userTextOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((b) => {
				if (b && typeof b === "object" && (b as { type?: unknown }).type === "text") {
					return asString((b as { text?: unknown }).text) ?? "";
				}
				return ""; // tool_result / image 等は発話ではない
			})
			.filter((t) => t.length > 0)
			.join("\n")
			.trim();
	}
	return "";
}

interface Entry {
	type?: unknown;
	isSidechain?: unknown;
	isMeta?: unknown;
	timestamp?: unknown;
	cwd?: unknown;
	sessionId?: unknown;
	aiTitle?: unknown;
	origin?: unknown;
	message?: unknown;
}

export function parseClaudeSession(
	content: string,
	fileName = ""
): ParsedSession | null {
	let sessionId: string | null = null;
	let startedAt: string | null = null;
	let endedAt: string | null = null;
	let cwd: string | null = null;
	let title: string | null = null;
	let lastAssistantMessage: string | null = null;
	const users: string[] = [];
	const commands = new CappedSet(MAX_COMMANDS);
	const files = new CappedSet(MAX_FILES);

	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		let obj: Entry;
		try {
			const parsed = JSON.parse(line);
			if (!parsed || typeof parsed !== "object") continue;
			obj = parsed as Entry;
		} catch {
			continue; // 壊れた行は無視
		}

		sessionId = sessionId ?? asString(obj.sessionId);
		cwd = cwd ?? asString(obj.cwd);

		const ts = asString(obj.timestamp);
		if (ts) {
			if (!startedAt || ts < startedAt) startedAt = ts;
			if (!endedAt || ts > endedAt) endedAt = ts;
		}

		const type = asString(obj.type);

		if (type === "ai-title") {
			title = asString(obj.aiTitle) ?? title;
			continue;
		}

		// サブエージェント(sidechain)・メタエントリの発話は数えない
		if (obj.isSidechain === true || obj.isMeta === true) continue;

		const message =
			obj.message && typeof obj.message === "object"
				? (obj.message as { role?: unknown; content?: unknown })
				: null;

		if (type === "user" && message) {
			// origin.kind があるフォーマットでは human 以外(task-notification 等)を除外
			const originKind =
				obj.origin && typeof obj.origin === "object"
					? asString((obj.origin as { kind?: unknown }).kind)
					: null;
			if (originKind && originKind !== "human") continue;
			const text = userTextOf(message.content);
			if (isRealUserText(text)) users.push(text.trim());
			continue;
		}

		if (type === "assistant" && message && Array.isArray(message.content)) {
			const assistantTexts: string[] = [];
			for (const b of message.content) {
				if (!b || typeof b !== "object") continue;
				const block = b as { type?: unknown; text?: unknown; name?: unknown; input?: unknown };
				if (block.type === "text") {
					const text = asString(block.text)?.trim();
					if (text) assistantTexts.push(text);
				} else if (block.type === "tool_use") {
					const name = asString(block.name) ?? "";
					const input =
						block.input && typeof block.input === "object"
							? (block.input as Record<string, unknown>)
							: {};
					if (name === "Bash") {
						commands.push(normalizeCommand(input.command));
					} else if (FILE_EDIT_TOOLS.has(name)) {
						files.push(asString(input.file_path) ?? undefined);
					}
				}
			}
			if (assistantTexts.length > 0) lastAssistantMessage = assistantTexts.join("\n");
			continue;
		}

		// mode / permission-mode / file-history-snapshot / system 等は無視
	}

	sessionId = sessionId ?? claudeSessionIdFromFileName(fileName);
	if (!sessionId) return null;

	const userMessages = users.map((m) =>
		m.length > MAX_TEXT_PER_MESSAGE ? m.slice(0, MAX_TEXT_PER_MESSAGE) : m
	);

	return {
		sessionId,
		source: "claude",
		startedAt,
		endedAt,
		cwd,
		title,
		firstUserPrompt: userMessages[0] ?? null,
		userMessages,
		lastAssistantMessage,
		commands: commands.values,
		files: relativizeFiles(files.values, cwd),
		turns: userMessages.length,
	};
}
