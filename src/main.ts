import {
	App,
	MarkdownPostProcessorContext,
	Modal,
	Notice,
	Plugin,
	TFile,
} from "obsidian";
import * as fs from "fs";
import * as os from "os";
import { ACSettingTab, ACSettings, DEFAULT_SETTINGS } from "./settings";
import { t } from "./i18n";
import { ConstellationEngine } from "./engine";
import { Ledger } from "./ledger";
import { expandHome } from "./utils";
import { resumeSession } from "./actions/resume";
import { generateBrief, markPromoted, promoteWithCodex } from "./actions/skill";

export default class AgentConstellationPlugin extends Plugin {
	settings: ACSettings = { ...DEFAULT_SETTINGS };
	engine!: ConstellationEngine;
	ledger!: Ledger;

	private watchers: fs.FSWatcher[] = [];
	private watchDebounce: number | null = null;
	private autoScanInterval: number | null = null;

	hostname(): string {
		return os.hostname();
	}

	codexSessionsDir(): string {
		return expandHome(this.settings.codexSessionsDir, os.homedir());
	}

	claudeSessionsDir(): string {
		return expandHome(this.settings.claudeSessionsDir, os.homedir());
	}

	async onload(): Promise<void> {
		await this.loadSettings();

		this.ledger = new Ledger(
			this.app.vault.adapter,
			this.hostname(),
			this.app.vault.configDir
		);
		await this.ledger.load();

		this.engine = new ConstellationEngine(
			this.app,
			() => this.settings,
			this.ledger,
			() => this.codexSessionsDir(),
			() => this.claudeSessionsDir(),
			() => this.saveSettings()
		);

		this.addSettingTab(new ACSettingTab(this.app, this));

		// ---------- コマンド ----------

		this.addCommand({
			id: "scan-sessions",
			name: t("cmd.scan"),
			callback: () => void this.engine.scan(),
		});

		this.addCommand({
			id: "rebuild-notes",
			name: t("cmd.rebuild"),
			callback: async () => {
				await this.engine.scan({ rebuildAll: true });
			},
		});

		this.addCommand({
			id: "resume-current",
			name: t("cmd.resume"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const fm = file ? this.frontmatterOf(file) : null;
				const sessionId = fm?.session_id;
				if (checking) return typeof sessionId === "string";
				if (typeof sessionId !== "string") return false;
				void resumeSession(
					this.app,
					this.settings,
					this.engine,
					sessionId,
					typeof fm?.cwd === "string" ? fm.cwd : null,
					typeof fm?.source === "string" ? fm.source : null
				);
				return true;
			},
		});

		this.addCommand({
			id: "open-setup-guide",
			name: t("cmd.setupGuide"),
			callback: () => new SetupGuideModal(this.app, this.settings.noteFolder).open(),
		});

		this.addRibbonIcon("orbit", t("ribbon.scan"), () => void this.engine.scan());

		// ---------- コードブロックプロセッサ(設計書 §5) ----------

		this.registerMarkdownCodeBlockProcessor("resume", (source, el, ctx) =>
			this.renderResumeBlock(source, el, ctx)
		);
		this.registerMarkdownCodeBlockProcessor("skill-promote", (source, el, ctx) =>
			this.renderSkillPromoteBlock(source, el, ctx)
		);

		// ---------- 自動処理 ----------

		this.restartAutoScan();
		this.restartWatcher();

		this.app.workspace.onLayoutReady(() => {
			if (!this.settings.setupShown) {
				this.settings.setupShown = true;
				void this.saveSettings();
				new SetupGuideModal(this.app, this.settings.noteFolder).open();
			}
			// 起動時スキャン(設計書 §4)。起動直後の負荷を避けて少し遅らせる
			window.setTimeout(() => void this.engine.scan({ silent: true }), 5_000);
		});
	}

	onunload(): void {
		this.stopWatcher();
	}

	// ---------- 設定 ----------

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ---------- 自動スキャン・ファイル監視(M4) ----------

	restartAutoScan(): void {
		if (this.autoScanInterval !== null) {
			window.clearInterval(this.autoScanInterval);
			this.autoScanInterval = null;
		}
		const min = this.settings.autoScanIntervalMin;
		if (min > 0) {
			this.autoScanInterval = window.setInterval(
				() => void this.engine.scan({ silent: true }),
				min * 60_000
			);
			this.registerInterval(this.autoScanInterval);
		}
	}

	restartWatcher(): void {
		this.stopWatcher();
		if (!this.settings.watchEnabled) return;
		for (const dir of [this.codexSessionsDir(), this.claudeSessionsDir()]) {
			if (!fs.existsSync(dir)) continue;
			try {
				// macOS は recursive watch に対応
				const watcher = fs.watch(dir, { recursive: true }, () => {
					if (this.watchDebounce !== null) window.clearTimeout(this.watchDebounce);
					this.watchDebounce = window.setTimeout(
						() => void this.engine.scan({ silent: true }),
						5_000
					);
				});
				this.watchers.push(watcher);
			} catch (e) {
				console.error(`[agent-constellation] ファイル監視の開始に失敗しました: ${dir}`, e);
			}
		}
	}

	private stopWatcher(): void {
		for (const w of this.watchers) w.close();
		this.watchers = [];
		if (this.watchDebounce !== null) {
			window.clearTimeout(this.watchDebounce);
			this.watchDebounce = null;
		}
	}

	// ---------- コードブロック描画 ----------

	private frontmatterOf(file: TFile): Record<string, unknown> | null {
		return (
			(this.app.metadataCache.getFileCache(file)?.frontmatter as
				| Record<string, unknown>
				| undefined) ?? null
		);
	}

	private parseBlockParams(source: string): Record<string, string> {
		const params: Record<string, string> = {};
		for (const line of source.split("\n")) {
			const idx = line.indexOf(":");
			if (idx < 0) continue;
			const key = line.slice(0, idx).trim();
			const value = line.slice(idx + 1).trim();
			if (key) params[key] = value;
		}
		return params;
	}

	/**
	 * ボタン共通ラッパ: 処理中表示・連打防止・エラー通知。
	 * 処理の成否がボタンの見た目とNoticeで分かるようにする。
	 */
	private async withBusy(
		button: HTMLButtonElement,
		busyText: string,
		fn: () => Promise<void>
	): Promise<void> {
		if (button.disabled) return;
		const original = button.textContent;
		button.disabled = true;
		button.textContent = busyText;
		try {
			await fn();
		} catch (e) {
			console.error("[agent-constellation] ボタン処理に失敗", e);
			new Notice(
				t("notice.buttonFailed", { msg: e instanceof Error ? e.message : String(e) }),
				8000
			);
		} finally {
			button.disabled = false;
			button.textContent = original;
		}
	}

	private renderResumeBlock(
		source: string,
		el: HTMLElement,
		_ctx: MarkdownPostProcessorContext
	): void {
		const params = this.parseBlockParams(source);
		const sessionId = params["session_id"] ?? "";
		const cwd = params["cwd"] || null;
		const sourceId = params["source"] || null;

		const container = el.createDiv({ cls: "agent-constellation-resume" });
		const button = container.createEl("button", {
			text: t("btn.resume"),
		});
		button.addEventListener("click", () => {
			void this.withBusy(button, t("busy.launching"), () =>
				resumeSession(this.app, this.settings, this.engine, sessionId, cwd, sourceId)
			);
		});
		if (cwd) {
			container.createEl("span", {
				text: ` ${cwd}`,
				cls: "agent-constellation-resume-cwd",
			});
		}
	}

	private renderSkillPromoteBlock(
		source: string,
		el: HTMLElement,
		_ctx: MarkdownPostProcessorContext
	): void {
		const params = this.parseBlockParams(source);
		const clusterId = params["cluster_id"] ?? "";
		const container = el.createDiv({ cls: "agent-constellation-skill" });

		const promoteBtn = container.createEl("button", {
			text: t("btn.promote"),
		});
		promoteBtn.addEventListener("click", () => {
			void this.withBusy(promoteBtn, t("busy.generatingBrief"), () =>
				promoteWithCodex(this.app, this.settings, this.engine, clusterId)
			);
		});

		const briefBtn = container.createEl("button", {
			text: t("btn.brief"),
		});
		briefBtn.addEventListener("click", () => {
			void this.withBusy(briefBtn, t("busy.generating"), async () => {
				await generateBrief(this.app, this.settings, this.engine, clusterId);
			});
		});

		const doneBtn = container.createEl("button", {
			text: t("btn.markPromoted"),
		});
		doneBtn.addEventListener("click", () => {
			void this.withBusy(doneBtn, t("busy.updating"), () =>
				markPromoted(this.engine, clusterId)
			);
		});
	}
}

/** 初回セットアップ案内(設計書 §2.2・§5.3) */
class SetupGuideModal extends Modal {
	constructor(
		app: App,
		private noteFolder: string
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		const folder = this.noteFolder;
		contentEl.createEl("h2", { text: t("setup.title") });

		contentEl.createEl("p", { text: t("setup.intro", { folder }) });

		contentEl.createEl("h3", { text: t("setup.graphHeading") });
		const ul = contentEl.createEl("ul");
		ul.createEl("li", { text: t("setup.graphFilter", { folder }) });
		ul.createEl("li", { text: t("setup.graphGroupSession") });
		ul.createEl("li", { text: t("setup.graphGroupCluster", { folder }) });
		ul.createEl("li", { text: t("setup.graphGroupCandidate") });

		contentEl.createEl("h3", { text: t("setup.excludeHeading") });
		contentEl.createEl("p", { text: t("setup.excludeBody", { folder }) });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
