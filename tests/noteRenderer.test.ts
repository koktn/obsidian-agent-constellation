import { describe, expect, it } from "vitest";
import {
	makeSummary,
	makeTitle,
	renderBrief,
	renderClusterNote,
	renderSessionNote,
	sanitizeFileName,
	sanitizeTag,
	summarizeCommonPatterns,
} from "../src/noteRenderer";
import type { StoredCluster, StoredSession } from "../src/types";

function session(over: Partial<StoredSession> = {}): StoredSession {
	return {
		sessionId: "0198aaaa-bbbb",
		source: "codex",
		filePath: "/Users/me/.codex/sessions/2026/07/21/rollout-x.jsonl",
		mtime: 0,
		size: 0,
		startedAt: "2026-07-21T10:32:00+09:00",
		endedAt: "2026-07-21T10:40:00+09:00",
		cwd: "/Users/me/dev/myapp",
		repo: "myapp",
		title: "pre-commitフック設定",
		prompt: "huskyでpre-commitにlint-stagedを設定して",
		text: "huskyでpre-commitにlint-stagedを設定して",
		commands: ["npm i -D husky lint-staged"],
		files: [".husky/pre-commit", "package.json"],
		turns: 1,
		summary: "依頼: husky…\n結果: 設定完了",
		notePath: "_Constellation/sessions/2026-07-21 pre-commitフック設定.md",
		...over,
	};
}

describe("sanitizeFileName / sanitizeTag", () => {
	it("ファイル名に使えない文字を除去する", () => {
		expect(sanitizeFileName('a/b:c*d?"e<f>g|h#i^j[k]l')).toBe(
			"a b c d e f g h i j k l"
		);
	});
	it("タグを安全な形にする", () => {
		expect(sanitizeTag("git hooks 設定")).toBe("git-hooks-設定");
	});
});

describe("makeTitle", () => {
	it("先頭プロンプトから短いタイトルを作る", () => {
		expect(makeTitle("huskyでpre-commitにlint-stagedを設定して", "id")).toBe(
			"huskyでpre-commitにlint-stagedを設定して"
		);
	});
	it("長文は40文字に切る", () => {
		expect(makeTitle("あ".repeat(100), "id")).toHaveLength(40);
	});
	it("プロンプトが無ければセッションIDで代替する", () => {
		expect(makeTitle(null, "0198aaaa-bbbb")).toBe("セッション 0198aaaa");
	});
});

describe("makeSummary", () => {
	it("依頼と結果の2行を作る", () => {
		const s = makeSummary("やって", "やりました");
		expect(s).toContain("依頼: やって");
		expect(s).toContain("結果: やりました");
	});
});

describe("renderSessionNote", () => {
	const md = renderSessionNote(
		session(),
		[{ noteBasename: "2026-07-10 husky導入" }],
		{
			clusterId: "git-hooks",
			notePath: "_Constellation/clusters/cluster - git-hooks.md",
		}
	);

	it("frontmatter に必須項目を含む", () => {
		expect(md).toContain("type: agent-session");
		expect(md).toContain('session_id: "0198aaaa-bbbb"');
		expect(md).toContain('repo: "myapp"');
		expect(md).toContain("generated: true");
		expect(md).toContain("tags: [agent-session, cluster/git-hooks]");
	});

	it("本文にプロンプト・コマンド・リンク・resume ブロックを含む", () => {
		expect(md).toContain("## プロンプト");
		expect(md).toContain("`npm i -D husky lint-staged`");
		expect(md).toContain("[[2026-07-10 husky導入]]");
		expect(md).toContain("[[cluster - git-hooks]]");
		expect(md).toContain("```resume");
		expect(md).toContain("session_id: 0198aaaa-bbbb");
	});
});

describe("renderClusterNote / summarizeCommonPatterns / renderBrief", () => {
	const cluster: StoredCluster = {
		clusterId: "git-hooks",
		name: "git-hooks",
		members: ["a", "b"],
		skillStatus: "candidate",
		notePath: "_Constellation/clusters/cluster - git-hooks.md",
	};
	const sessions = [
		session({ sessionId: "a" }),
		session({
			sessionId: "b",
			title: "husky導入",
			notePath: "_Constellation/sessions/2026-07-10 husky導入.md",
			commands: ["npm i -D husky lint-staged", "npx husky init"],
		}),
	];

	it("ハブノートに所属セッションと skill-promote ブロックを含む", () => {
		const md = renderClusterNote(cluster, sessions, summarizeCommonPatterns(sessions));
		expect(md).toContain("type: agent-cluster");
		expect(md).toContain("skill_status: candidate");
		expect(md).toContain("tags: [agent-cluster, skill-candidate]");
		expect(md).toContain("[[2026-07-10 husky導入]]");
		expect(md).toContain("```skill-promote");
		expect(md).toContain("cluster_id: git-hooks");
	});

	it("共通コマンドを頻度付きで列挙する", () => {
		const s = summarizeCommonPatterns(sessions);
		expect(s).toContain("npm i -D husky lint-staged");
		expect(s).toContain("(2/2)");
	});

	it("ブリーフにプロンプト全文と可変部分を含む", () => {
		const md = renderBrief(cluster, sessions, summarizeCommonPatterns(sessions));
		expect(md).toContain("# Skill化ブリーフ: git-hooks");
		expect(md).toContain("huskyでpre-commitにlint-stagedを設定して");
		expect(md).toContain("npx husky init");
		expect(md).toContain("パラメータ候補");
	});
});
