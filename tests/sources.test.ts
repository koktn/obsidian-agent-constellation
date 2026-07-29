import { describe, expect, it } from "vitest";
import { CodexSource } from "../src/sources/CodexSource";
import { ClaudeCodeSource } from "../src/sources/ClaudeCodeSource";
import { shellQuote } from "../src/utils";

describe("shellQuote", () => {
	it("シングルクォートで包む", () => {
		expect(shellQuote("/Users/me/dev/myapp")).toBe("'/Users/me/dev/myapp'");
	});
	it("クォート内のシングルクォートをエスケープする", () => {
		expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
	});
});

describe("buildResumeCommand", () => {
	const codex = new CodexSource(() => "/tmp");
	const claude = new ClaudeCodeSource(() => "/tmp");

	it("codex: session id と cwd をシェルクォートする", () => {
		expect(
			codex.buildResumeCommand("0198aaaa-bbbb", "/Users/me/dev/my app")
		).toBe("cd '/Users/me/dev/my app' && codex resume '0198aaaa-bbbb'");
	});

	it("claude: session id と cwd をシェルクォートする", () => {
		expect(
			claude.buildResumeCommand("71aa38e3-e271", "/Users/me/dev/myapp")
		).toBe("cd '/Users/me/dev/myapp' && claude --resume '71aa38e3-e271'");
	});

	it("cwd 無しでは cd を付けない", () => {
		expect(codex.buildResumeCommand("id-1", null)).toBe("codex resume 'id-1'");
		expect(claude.buildResumeCommand("id-1", null)).toBe("claude --resume 'id-1'");
	});

	it("不正な文字列を含む id でもコマンド注入にならない", () => {
		const evil = "x'; rm -rf ~; echo '";
		const cmd = codex.buildResumeCommand(evil, null);
		expect(cmd).toBe(`codex resume 'x'\\''; rm -rf ~; echo '\\'''`);
	});
});
