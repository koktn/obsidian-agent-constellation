import { describe, expect, it } from "vitest";
import {
	candidateMemberKeys,
	linkDensity,
	markDuplicateSessions,
	sessionStorageKey,
} from "../src/sessionPolicy";
import type { StoredSession } from "../src/types";

function session(key: string, startedAt: string, text = key): StoredSession {
	const [source, ...id] = key.split(":");
	return {
		key,
		sessionId: id.join(":"),
		source: source === "claude" ? "claude" : "codex",
		filePath: `/tmp/${key}`,
		mtime: 0,
		size: 0,
		startedAt,
		endedAt: startedAt,
		cwd: "/repo",
		repo: "repo",
		title: text,
		prompt: text,
		text,
		commands: ["npm test"],
		files: ["src/main.ts"],
		turns: 1,
		lastAssistantMessage: "done",
		summary: "done",
		notePath: `${key}.md`,
	};
}

describe("session policy", () => {
	it("sourceを含む一意キーを作る", () => {
		expect(sessionStorageKey("codex", "same")).toBe("codex:same");
		expect(sessionStorageKey("claude", "same")).toBe("claude:same");
	});

	it("期間外と重複候補をSkill評価から除外する", () => {
		const now = Date.parse("2026-09-01T00:00:00Z");
		const recent = session("codex:a", "2026-08-30T00:00:00Z");
		const duplicate = session("codex:b", "2026-08-30T00:00:00Z");
		duplicate.duplicateOf = recent.key;
		const old = session("codex:c", "2026-07-01T00:00:00Z");
		expect(candidateMemberKeys([recent, duplicate, old], 30, now)).toEqual([recent.key]);
	});

	it("完全一致ログを重複候補として印付けする", () => {
		const a = session("codex:a", "2026-08-30T00:00:00Z", "same");
		const b = session("codex:b", "2026-08-30T00:00:00Z", "same");
		markDuplicateSessions([a, b]);
		expect(a.duplicateOf).toBeUndefined();
		expect(b.duplicateOf).toBe(a.key);
	});

	it("候補内のリンク密度を計算する", () => {
		expect(
			linkDensity(
				["a", "b", "c"],
				[
					{ a: "a", b: "b", score: 0.9 },
					{ a: "b", b: "c", score: 0.8 },
				],
			),
		).toBeCloseTo(2 / 3);
	});
});
