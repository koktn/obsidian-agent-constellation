import type { ParsedSession } from "../types";
import {
	MAX_COMMANDS,
	MAX_FILES,
	MAX_TEXT_PER_MESSAGE,
	asString,
	normalizeCommand,
	relativizeFiles,
} from "./common";

/**
 * Codex CLI の rollout JSONL パーサ。
 * スキーマは非公式・変更されうるため、既知の複数フォーマットを防御的に扱い、
 * 未知のイベントは無視する(設計書 §12)。
 */

const FILE_NAME_RE =
	/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/;

const PATCH_FILE_RE = /^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s+(.+)\s*$/gm;

export function sessionIdFromFileName(fileName: string): string | null {
	const m = FILE_NAME_RE.exec(fileName);
	return m ? m[1] : null;
}

/** message の content からテキストを取り出す(文字列 / {text} 配列の両対応) */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((c) => {
				if (typeof c === "string") return c;
				if (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string") {
					return (c as { text: string }).text;
				}
				return "";
			})
			.join("")
			.trim();
	}
	return "";
}

/**
 * Codex はユーザーメッセージとして <environment_context> や <user_instructions>、
 * AGENTS.md の前置き(`# AGENTS.md instructions for ...`)などの機械挿入テキストも
 * 記録するため、本物のユーザー発話だけを残す。
 */
const MACHINE_PREAMBLE_RE = /^#+\s*AGENTS\.md instructions\b/i;

function isRealUserText(text: string): boolean {
	const t = text.trim();
	if (t.length === 0) return false;
	if (t.startsWith("<")) return false;
	if (MACHINE_PREAMBLE_RE.test(t)) return false;
	return true;
}

function filesFromPatchText(patch: string): string[] {
	const files: string[] = [];
	let m: RegExpExecArray | null;
	PATCH_FILE_RE.lastIndex = 0;
	while ((m = PATCH_FILE_RE.exec(patch)) !== null) {
		files.push(m[1].trim());
	}
	return files;
}

interface Acc {
	sessionId: string | null;
	startedAt: string | null;
	endedAt: string | null;
	cwd: string | null;
	userMessages: string[];
	lastAssistantMessage: string | null;
	commands: string[];
	commandSeen: Set<string>;
	files: string[];
	fileSeen: Set<string>;
}

function pushCommand(acc: Acc, cmd: string | null): void {
	if (!cmd || acc.commandSeen.has(cmd) || acc.commands.length >= MAX_COMMANDS) return;
	acc.commandSeen.add(cmd);
	acc.commands.push(cmd);
}

function pushFile(acc: Acc, file: string): void {
	const f = file.trim();
	if (!f || acc.fileSeen.has(f) || acc.files.length >= MAX_FILES) return;
	acc.fileSeen.add(f);
	acc.files.push(f);
}

function pushUser(acc: Acc, text: string): void {
	if (!isRealUserText(text)) return;
	const t = text.trim();
	// 同じ発話が response_item と event_msg の両方に連続記録される形式だけを除外する。
	if (acc.userMessages.at(-1) === t) return;
	acc.userMessages.push(t);
}

/** response_item(新形式)/ トップレベル item(旧形式)の両方を処理 */
function handleItem(acc: Acc, it: Record<string, unknown>): void {
	const type = asString(it.type);
	if (type === "message") {
		const role = asString(it.role);
		const text = extractText(it.content);
		if (role === "user") {
			pushUser(acc, text);
		} else if (role === "assistant" && text.trim().length > 0) {
			acc.lastAssistantMessage = text.trim();
		}
		return;
	}
	if (type === "function_call" || type === "custom_tool_call") {
		const name = asString(it.name) ?? "";
		const rawArgs = asString(it.arguments) ?? asString(it.input) ?? "";
		let args: Record<string, unknown> = {};
		if (rawArgs) {
			try {
				const parsed = JSON.parse(rawArgs);
				if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
			} catch {
				// arguments が JSON でない(apply_patch の生テキスト等)場合はそのまま扱う
			}
		}
		if (name === "apply_patch") {
			const patch = asString(args.input) ?? rawArgs;
			for (const f of filesFromPatchText(patch)) pushFile(acc, f);
			return;
		}
		const cmd = normalizeCommand(args.command ?? args.cmd);
		if (cmd) {
			pushCommand(acc, cmd);
			if (cmd.includes("apply_patch")) {
				for (const f of filesFromPatchText(cmd)) pushFile(acc, f);
			}
		}
		return;
	}
	if (type === "local_shell_call") {
		const action = it.action as Record<string, unknown> | undefined;
		pushCommand(acc, normalizeCommand(action?.command));
		return;
	}
	// 未知の item は無視
}

/** event_msg(新形式)を処理 */
function handleEvent(acc: Acc, p: Record<string, unknown>): void {
	const type = asString(p.type);
	switch (type) {
		case "user_message": {
			const msg = asString(p.message);
			if (msg) pushUser(acc, msg);
			break;
		}
		case "agent_message": {
			const msg = asString(p.message);
			if (msg && msg.trim().length > 0) acc.lastAssistantMessage = msg.trim();
			break;
		}
		case "exec_command_begin": {
			pushCommand(acc, normalizeCommand(p.command));
			break;
		}
		case "patch_apply_begin": {
			const changes = p.changes;
			if (changes && typeof changes === "object") {
				for (const key of Object.keys(changes as Record<string, unknown>)) {
					pushFile(acc, key);
				}
			}
			break;
		}
		case "session_configured": {
			acc.sessionId = acc.sessionId ?? asString(p.session_id);
			break;
		}
		default:
			break; // 未知のイベントは無視
	}
}

/**
 * rollout JSONL の全文をパースする。
 * 1行も解釈できない・セッションIDが特定できない場合は null。
 */
export function parseRollout(content: string, fileName = ""): ParsedSession | null {
	const acc: Acc = {
		sessionId: null,
		startedAt: null,
		endedAt: null,
		cwd: null,
		userMessages: [],
		lastAssistantMessage: null,
		commands: [],
		commandSeen: new Set(),
		files: [],
		fileSeen: new Set(),
	};

	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		let obj: Record<string, unknown>;
		try {
			const parsed = JSON.parse(line);
			if (!parsed || typeof parsed !== "object") continue;
			obj = parsed as Record<string, unknown>;
		} catch {
			continue; // 壊れた行は無視
		}

		const ts = asString(obj.timestamp);
		if (ts) {
			if (!acc.startedAt || ts < acc.startedAt) acc.startedAt = ts;
			if (!acc.endedAt || ts > acc.endedAt) acc.endedAt = ts;
		}

		const type = asString(obj.type);
		const payload =
			obj.payload && typeof obj.payload === "object"
				? (obj.payload as Record<string, unknown>)
				: null;

		if (type === "session_meta" && payload) {
			acc.sessionId = acc.sessionId ?? asString(payload.id);
			acc.cwd = acc.cwd ?? asString(payload.cwd);
			const metaTs = asString(payload.timestamp);
			if (metaTs && (!acc.startedAt || metaTs < acc.startedAt)) acc.startedAt = metaTs;
		} else if (type === "turn_context" && payload) {
			acc.cwd = asString(payload.cwd) ?? acc.cwd;
		} else if (type === "response_item" && payload) {
			handleItem(acc, payload);
		} else if (type === "event_msg" && payload) {
			handleEvent(acc, payload);
		} else if (!type && typeof obj.id === "string" && "timestamp" in obj) {
			// 旧形式: 先頭行がセッションメタ({id, timestamp, instructions, ...})
			acc.sessionId = acc.sessionId ?? asString(obj.id);
			acc.cwd = acc.cwd ?? asString(obj.cwd);
		} else if (type) {
			// 旧形式: response item がトップレベルに並ぶ
			handleItem(acc, obj);
		}
	}

	const sessionId = acc.sessionId ?? sessionIdFromFileName(fileName);
	if (!sessionId) return null;

	const userMessages = acc.userMessages.map((m) =>
		m.length > MAX_TEXT_PER_MESSAGE ? m.slice(0, MAX_TEXT_PER_MESSAGE) : m
	);

	return {
		sessionId,
		source: "codex",
		startedAt: acc.startedAt,
		endedAt: acc.endedAt,
		cwd: acc.cwd,
		title: null,
		firstUserPrompt: userMessages[0] ?? null,
		userMessages,
		lastAssistantMessage: acc.lastAssistantMessage,
		commands: acc.commands,
		files: relativizeFiles(acc.files, acc.cwd),
		turns: userMessages.length,
	};
}
