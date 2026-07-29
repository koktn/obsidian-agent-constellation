import { App, Modal, Notice, Setting } from "obsidian";
import * as fs from "fs";
import * as os from "os";
import type { ACSettings } from "../settings";
import type { ConstellationEngine } from "../engine";
import { runInTerminal } from "./terminal";

/**
 * Resume 機能(設計書 §7・§12)。
 * cwd やセッション実体の存在チェックを行い、無い場合は日本語で案内する。
 */
export async function resumeSession(
	app: App,
	settings: ACSettings,
	engine: ConstellationEngine,
	sessionId: string,
	cwd: string | null,
	sourceId: string | null = null
): Promise<void> {
	if (!sessionId) {
		new Notice("session_id が見つかりません。");
		return;
	}

	// セッション実体の存在チェック(同期環境では別マシンに実体がない、設計書 §12)
	const stored = engine.ledger.data.sessions[sessionId];
	const sessionFile = stored?.filePath ?? null;
	if (sessionFile && !fs.existsSync(sessionFile)) {
		new Notice(
			"このマシンにはセッションの実体が見つかりません。セッションを実行したマシンで再開してください。",
			8000
		);
		return;
	}

	const source = sourceId ?? stored?.source ?? null;
	const effectiveCwd = cwd && cwd.length > 0 ? cwd : (stored?.cwd ?? null);
	const command = engine.buildResumeCommand(source, sessionId, effectiveCwd);

	if (effectiveCwd && !fs.existsSync(effectiveCwd)) {
		new MissingCwdModal(app, effectiveCwd, async (choice) => {
			if (choice === "home") {
				const homeCmd = engine.buildResumeCommand(source, sessionId, os.homedir());
				await runInTerminal(settings.terminal, homeCmd, os.homedir());
			} else if (choice === "copy") {
				await navigator.clipboard.writeText(command);
				new Notice("コマンドをクリップボードにコピーしました。");
			}
		}).open();
		return;
	}

	await runInTerminal(settings.terminal, command, effectiveCwd);
}

type MissingCwdChoice = "home" | "copy" | "cancel";

class MissingCwdModal extends Modal {
	constructor(
		app: App,
		private cwd: string,
		private onChoose: (choice: MissingCwdChoice) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "作業ディレクトリが見つかりません" });
		contentEl.createEl("p", {
			text: `元の作業ディレクトリ ${this.cwd} は存在しません。どうしますか?`,
		});
		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("ホームディレクトリで再開")
					.setCta()
					.onClick(() => {
						this.close();
						this.onChoose("home");
					})
			)
			.addButton((b) =>
				b.setButtonText("コマンドをコピーのみ").onClick(() => {
					this.close();
					this.onChoose("copy");
				})
			)
			.addButton((b) =>
				b.setButtonText("キャンセル").onClick(() => {
					this.close();
					this.onChoose("cancel");
				})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
