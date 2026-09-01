import { describe, expect, it } from "vitest";
import { claudeSessionIdFromFileName, parseClaudeSession } from "../src/parser/claudeParser";

const SESSION_ID = "71aa38e3-e271-42c5-8a94-197b933dba4f";
const FILE = `${SESSION_ID}.jsonl`;

function jsonl(lines: unknown[]): string {
	return lines.map((l) => JSON.stringify(l)).join("\n");
}

/** 実データ(~/.claude/projects)の構造を模したフィクスチャ */
const LINES: unknown[] = [
	{ type: "mode", mode: "normal", sessionId: SESSION_ID },
	{ type: "permission-mode", permissionMode: "default", sessionId: SESSION_ID },
	{
		type: "file-history-snapshot",
		messageId: "m1",
		snapshot: { trackedFileBackups: {}, timestamp: "2026-07-11T23:42:34.967Z" },
	},
	{
		type: "user",
		isSidechain: false,
		message: {
			role: "user",
			content: "chromeにアプリをインストールしました。READMEの対応をしてください",
		},
		timestamp: "2026-07-11T23:42:34.966Z",
		origin: { kind: "human" },
		cwd: "/Users/me/dev/adapp",
		sessionId: SESSION_ID,
	},
	{ type: "ai-title", aiTitle: "Yahoo リクエスト署名対応", sessionId: SESSION_ID },
	{
		type: "assistant",
		isSidechain: false,
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "…" },
				{ type: "text", text: "確認します。" },
				{
					type: "tool_use",
					name: "Bash",
					input: { command: "npm test", description: "Run tests" },
				},
				{
					type: "tool_use",
					name: "Edit",
					input: {
						file_path: "/Users/me/dev/adapp/src/providers/yahoo.ts",
						old_string: "a",
						new_string: "b",
					},
				},
				{
					type: "tool_use",
					name: "Read",
					input: { file_path: "/Users/me/dev/adapp/README.md" },
				},
			],
		},
		timestamp: "2026-07-11T23:43:00.000Z",
		cwd: "/Users/me/dev/adapp",
		sessionId: SESSION_ID,
	},
	// tool_result はユーザー発話ではない
	{
		type: "user",
		isSidechain: false,
		message: {
			role: "user",
			content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
		},
		timestamp: "2026-07-11T23:43:10.000Z",
		sessionId: SESSION_ID,
	},
	// タスク通知(origin が human でない)は除外
	{
		type: "user",
		message: { role: "user", content: "<task-notification>...</task-notification>" },
		origin: { kind: "task-notification" },
		timestamp: "2026-07-11T23:44:00.000Z",
		sessionId: SESSION_ID,
	},
	// ローカルコマンドのログは除外
	{
		type: "user",
		message: { role: "user", content: "<command-name>/model</command-name>" },
		timestamp: "2026-07-11T23:44:10.000Z",
		sessionId: SESSION_ID,
	},
	{
		type: "user",
		isMeta: true,
		message: { role: "user", content: "Caveat: The messages below were generated..." },
		timestamp: "2026-07-11T23:44:20.000Z",
		sessionId: SESSION_ID,
	},
	// サブエージェント(sidechain)の発話は除外
	{
		type: "user",
		isSidechain: true,
		message: { role: "user", content: "サブエージェントへの指示" },
		timestamp: "2026-07-11T23:45:00.000Z",
		sessionId: SESSION_ID,
	},
	// 画像添付付きの本物の発話(text ブロックのみ拾う)
	{
		type: "user",
		message: {
			role: "user",
			content: [
				{ type: "text", text: "スクリーンショットの表示は仕様上問題ない？" },
				{ type: "image", source: { type: "base64", media_type: "image/png", data: "x" } },
			],
		},
		origin: { kind: "human" },
		timestamp: "2026-07-11T23:46:00.000Z",
		sessionId: SESSION_ID,
	},
	{
		type: "assistant",
		message: { role: "assistant", content: [{ type: "text", text: "対応が完了しました。" }] },
		timestamp: "2026-07-11T23:50:00.000Z",
		sessionId: SESSION_ID,
	},
	{
		type: "system",
		subtype: "turn_duration",
		durationMs: 1000,
		timestamp: "2026-07-11T23:50:47.133Z",
	},
];

describe("claudeSessionIdFromFileName", () => {
	it("uuid.jsonl から ID を取り出す", () => {
		expect(claudeSessionIdFromFileName(FILE)).toBe(SESSION_ID);
	});
	it("uuid 形式以外は null", () => {
		expect(claudeSessionIdFromFileName("notes.jsonl")).toBeNull();
		expect(claudeSessionIdFromFileName("rollout-2026-07-21T10-32-00-x.jsonl")).toBeNull();
	});
});

describe("parseClaudeSession", () => {
	const s = parseClaudeSession(jsonl(LINES), FILE)!;

	it("メタデータと ai-title を抽出する", () => {
		expect(s).not.toBeNull();
		expect(s.source).toBe("claude");
		expect(s.sessionId).toBe(SESSION_ID);
		expect(s.cwd).toBe("/Users/me/dev/adapp");
		expect(s.title).toBe("Yahoo リクエスト署名対応");
		expect(s.startedAt).toBe("2026-07-11T23:42:34.966Z");
		expect(s.endedAt).toBe("2026-07-11T23:50:47.133Z");
	});

	it("本物のユーザー発話だけを拾う(tool_result・通知・sidechain・メタは除外)", () => {
		expect(s.userMessages).toEqual([
			"chromeにアプリをインストールしました。READMEの対応をしてください",
			"スクリーンショットの表示は仕様上問題ない？",
		]);
		expect(s.turns).toBe(2);
	});

	it("Bash の command と編集ツールの file_path を集める(Read は含めない)", () => {
		expect(s.commands).toEqual(["npm test"]);
		expect(s.files).toEqual(["src/providers/yahoo.ts"]);
	});

	it("末尾のアシスタント発話を保持する", () => {
		expect(s.lastAssistantMessage).toBe("対応が完了しました。");
	});

	it("ID 不明でもファイル名から復元できれば成立する", () => {
		const t = parseClaudeSession("not json", FILE);
		expect(t?.sessionId).toBe(SESSION_ID);
		expect(t?.turns).toBe(0);
	});

	it("同じ文面の別ターンを保持し、最終回答のtext blockを連結する", () => {
		const entries = [
			{ type: "user", sessionId: SESSION_ID, message: { role: "user", content: "もう一度" } },
			{
				type: "assistant",
				sessionId: SESSION_ID,
				message: { role: "assistant", content: [{ type: "text", text: "前半" }] },
			},
			{ type: "user", sessionId: SESSION_ID, message: { role: "user", content: "もう一度" } },
			{
				type: "assistant",
				sessionId: SESSION_ID,
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "結果1" },
						{ type: "text", text: "結果2" },
					],
				},
			},
		];
		const parsed = parseClaudeSession(jsonl(entries), FILE)!;
		expect(parsed.userMessages).toEqual(["もう一度", "もう一度"]);
		expect(parsed.turns).toBe(2);
		expect(parsed.lastAssistantMessage).toBe("結果1\n結果2");
	});
});
