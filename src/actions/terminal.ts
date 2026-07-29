import { Notice } from "obsidian";
import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import type { TerminalKind } from "../settings";
import { t } from "../i18n";

/**
 * ターミナル起動(設計書 §7)。
 * Terminal.app: AppleScript(ログインシェル経由で確実)
 * Ghostty: アプリバイナリを直接起動する。`open -na Ghostty --args -e` は
 *          Ghostty 側の実行許可ダイアログが出るため使わない。
 *          `--working-directory` で元セッションの cwd を引き継ぎ、
 *          `zsh -lic` で .zprofile/.zshrc を読ませて nvm/bun 等の PATH を継承する
 *          (PATH 不足による codex/claude 本体や MCP サーバの起動失敗を防ぐ)。
 *          失敗時は Ghostty を開きコマンドをクリップボードにコピーするフォールバック。
 * clipboard: コピーのみ。
 */

function execFileP(cmd: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, (err) => (err ? reject(err) : resolve()));
	});
}

/** 子プロセスを切り離して起動する(終了を待たない。ウィンドウを閉じるまで待つのを防ぐ) */
function spawnDetached(cmd: string, args: string[], cwd?: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { detached: true, stdio: "ignore", cwd });
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}

function escapeAppleScript(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function copyToClipboard(text: string): Promise<void> {
	await navigator.clipboard.writeText(text);
}

async function launchTerminalApp(command: string): Promise<void> {
	const script = `tell application "Terminal"
	do script "${escapeAppleScript(command)}"
	activate
end tell`;
	await execFileP("osascript", ["-e", script]);
}

function ghosttyBinary(): string | null {
	const candidates = [
		"/Applications/Ghostty.app/Contents/MacOS/ghostty",
		`${os.homedir()}/Applications/Ghostty.app/Contents/MacOS/ghostty`,
	];
	return candidates.find((p) => fs.existsSync(p)) ?? null;
}

async function ghosttyFallback(command: string): Promise<void> {
	await copyToClipboard(command);
	new Notice(t("notice.ghosttyFallback"));
	try {
		await execFileP("open", ["-a", "Ghostty"]);
	} catch {
		// Ghostty 未インストールなどは通知のみ
	}
}

async function launchGhostty(command: string, cwd: string | null): Promise<void> {
	const bin = ghosttyBinary();
	if (!bin) {
		await ghosttyFallback(command);
		return;
	}
	try {
		const args: string[] = [];
		const dir = cwd && fs.existsSync(cwd) ? cwd : undefined;
		// --working-directory と spawn の cwd の両方で作業ディレクトリを引き継ぐ
		// (Ghostty は環境により親プロセスの cwd を優先することがあるため)
		if (dir) args.push(`--working-directory=${dir}`);
		args.push("-e", "zsh", "-lic", command);
		await spawnDetached(bin, args, dir);
	} catch (e) {
		console.error("[agent-constellation] Ghostty 起動失敗、フォールバックします", e);
		await ghosttyFallback(command);
	}
}

export async function runInTerminal(
	kind: TerminalKind,
	command: string,
	cwd: string | null = null
): Promise<void> {
	if (process.platform !== "darwin" && kind !== "clipboard") {
		await copyToClipboard(command);
		new Notice(t("notice.macOnly"));
		return;
	}
	switch (kind) {
		case "terminal":
			try {
				await launchTerminalApp(command);
			} catch (e) {
				console.error("[agent-constellation] Terminal.app 起動失敗", e);
				await copyToClipboard(command);
				new Notice(t("notice.terminalFailed"));
			}
			break;
		case "ghostty":
			await launchGhostty(command, cwd);
			break;
		case "clipboard":
			await copyToClipboard(command);
			new Notice(t("notice.copied"));
			break;
	}
}
