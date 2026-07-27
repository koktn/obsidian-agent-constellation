import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import {
	parseRollout,
	sessionIdFromFileName,
} from "../src/parser/codexParser";

function fixture(name: string): string {
	return readFileSync(
		fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
		"utf8"
	);
}

const NEW_FILE =
	"rollout-2026-07-21T10-32-00-0198aaaa-bbbb-cccc-dddd-eeeeffff0001.jsonl";
const OLD_FILE =
	"rollout-2026-06-01T09-00-00-0197old0-1111-2222-3333-444455556666.jsonl";

describe("sessionIdFromFileName", () => {
	it("rollout ファイル名から UUID を取り出す", () => {
		expect(sessionIdFromFileName(NEW_FILE)).toBe(
			"0198aaaa-bbbb-cccc-dddd-eeeeffff0001"
		);
	});
	it("形式外のファイル名は null", () => {
		expect(sessionIdFromFileName("notes.jsonl")).toBeNull();
	});
});

describe("parseRollout: 新形式(session_meta + response_item + event_msg)", () => {
	const s = parseRollout(fixture(NEW_FILE), NEW_FILE)!;

	it("メタデータを抽出する", () => {
		expect(s).not.toBeNull();
		expect(s.sessionId).toBe("0198aaaa-bbbb-cccc-dddd-eeeeffff0001");
		expect(s.cwd).toBe("/Users/me/dev/myapp");
		expect(s.startedAt).toBe("2026-07-21T01:32:00.000Z");
		expect(s.endedAt).toBe("2026-07-21T01:40:01.000Z");
	});

	it("機械挿入テキストを除いた本物のユーザー発話だけを拾う", () => {
		expect(s.userMessages).toEqual(["huskyでpre-commitにlint-stagedを設定して"]);
		expect(s.firstUserPrompt).toBe("huskyでpre-commitにlint-stagedを設定して");
		expect(s.turns).toBe(1);
	});

	it("bash -lc を剥がしてコマンドを集める", () => {
		expect(s.commands).toContain("npm i -D husky lint-staged");
		expect(s.commands).toContain("npx husky init");
		expect(s.commands).toContain("git status");
	});

	it("patch_apply_begin から変更ファイルを cwd 相対で集める", () => {
		expect(s.files).toContain(".husky/pre-commit");
		expect(s.files).toContain("package.json");
	});

	it("末尾のアシスタント発話を保持する", () => {
		expect(s.lastAssistantMessage).toContain("husky と lint-staged を設定しました");
	});
});

describe("parseRollout: 旧形式(トップレベル item)", () => {
	const s = parseRollout(fixture(OLD_FILE), OLD_FILE)!;

	it("先頭行メタからセッション情報を得る", () => {
		expect(s.sessionId).toBe("0197old0-1111-2222-3333-444455556666");
		expect(s.cwd).toBe("/Users/me/dev/oldapp");
	});

	it("発話・コマンド・ファイルを抽出する", () => {
		expect(s.userMessages).toEqual(["READMEを書いて"]);
		expect(s.commands).toContain("ls -la");
		expect(s.files).toContain("README.md");
		expect(s.lastAssistantMessage).toBe("READMEを作成しました");
	});
});

describe("parseRollout: 防御的動作", () => {
	it("空文字・ID不明は null", () => {
		expect(parseRollout("", "unknown.txt")).toBeNull();
		expect(parseRollout("{}\nnot json\n", "unknown.txt")).toBeNull();
	});

	it("ID不明でもファイル名から復元できれば成立する", () => {
		const s = parseRollout("not json at all", NEW_FILE);
		expect(s?.sessionId).toBe("0198aaaa-bbbb-cccc-dddd-eeeeffff0001");
		expect(s?.turns).toBe(0);
	});
});
