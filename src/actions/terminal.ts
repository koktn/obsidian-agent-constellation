import { Notice } from "obsidian";
import { execFile } from "child_process";
import type { TerminalKind } from "../settings";

/**
 * ターミナル起動(設計書 §7)。
 * Terminal.app: AppleScript(確実)
 * Ghostty: `open -na Ghostty --args -e ...`。失敗時は Ghostty を開き
 *          コマンドをクリップボードにコピーするフォールバック。
 * clipboard: コピーのみ。
 */

function execFileP(cmd: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, (err) => (err ? reject(err) : resolve()));
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

async function launchGhostty(command: string): Promise<void> {
	try {
		await execFileP("open", [
			"-na",
			"Ghostty",
			"--args",
			"-e",
			"sh",
			"-lc",
			command,
		]);
	} catch (e) {
		console.error("[agent-constellation] Ghostty 起動失敗、フォールバックします", e);
		await copyToClipboard(command);
		new Notice(
			"Ghostty のコマンド付き起動に失敗したため、コマンドをクリップボードにコピーしました。Ghostty に貼り付けて実行してください。"
		);
		try {
			await execFileP("open", ["-a", "Ghostty"]);
		} catch {
			// Ghostty 未インストールなどは通知のみ
		}
	}
}

export async function runInTerminal(
	kind: TerminalKind,
	command: string
): Promise<void> {
	if (process.platform !== "darwin" && kind !== "clipboard") {
		await copyToClipboard(command);
		new Notice(
			"ターミナル起動は macOS のみ対応です。コマンドをクリップボードにコピーしました。"
		);
		return;
	}
	switch (kind) {
		case "terminal":
			try {
				await launchTerminalApp(command);
			} catch (e) {
				console.error("[agent-constellation] Terminal.app 起動失敗", e);
				await copyToClipboard(command);
				new Notice(
					"Terminal.app の起動に失敗したため、コマンドをクリップボードにコピーしました。"
				);
			}
			break;
		case "ghostty":
			await launchGhostty(command);
			break;
		case "clipboard":
			await copyToClipboard(command);
			new Notice("コマンドをクリップボードにコピーしました。");
			break;
	}
}
