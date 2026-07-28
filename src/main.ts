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
			name: "セッションを取り込む(スキャン)",
			callback: () => void this.engine.scan(),
		});

		this.addCommand({
			id: "rebuild-notes",
			name: "ノートを全再生成",
			callback: async () => {
				await this.engine.scan({ rebuildAll: true });
			},
		});

		this.addCommand({
			id: "resume-current",
			name: "このセッションを再開",
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
			name: "セットアップガイドを表示",
			callback: () => new SetupGuideModal(this.app, this.settings.noteFolder).open(),
		});

		this.addRibbonIcon("orbit", "Agent Constellation: セッションを取り込む", () =>
			void this.engine.scan()
		);

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
			text: "▶ このセッションを再開",
		});
		button.addEventListener("click", () => {
			void resumeSession(this.app, this.settings, this.engine, sessionId, cwd, sourceId);
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
			text: "🚀 Codex に渡して Skill 化",
		});
		promoteBtn.addEventListener("click", () => {
			void promoteWithCodex(this.app, this.settings, this.engine, clusterId);
		});

		const briefBtn = container.createEl("button", {
			text: "📄 ブリーフのみ生成",
		});
		briefBtn.addEventListener("click", () => {
			void generateBrief(this.app, this.settings, this.engine, clusterId);
		});

		const doneBtn = container.createEl("button", {
			text: "✅ promoted にする",
		});
		doneBtn.addEventListener("click", () => {
			void markPromoted(this.engine, clusterId);
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
		contentEl.createEl("h2", { text: "Agent Constellation セットアップガイド" });

		contentEl.createEl("p", {
			text:
				"コマンドパレットの「セッションを取り込む(スキャン)」で Codex CLI / Claude Code のセッションが " +
				`${this.noteFolder}/ 配下のノートになります。`,
		});

		contentEl.createEl("h3", { text: "Graph View の推奨設定" });
		const ul = contentEl.createEl("ul");
		ul.createEl("li", {
			text: `フィルタ: path:${this.noteFolder} (星座だけを表示したい場合)`,
		});
		ul.createEl("li", { text: "グループ: tag:#agent-session → 灰色" });
		ul.createEl("li", {
			text: `グループ: path:${this.noteFolder}/clusters → 青(クラスタハブ)`,
		});
		ul.createEl("li", {
			text: "グループ: tag:#skill-candidate → 黄(Skill 候補が光る)",
		});

		contentEl.createEl("h3", { text: "フォルダが邪魔な場合" });
		contentEl.createEl("p", {
			text:
				"設定 → ファイルとリンク → 除外ファイル(Excluded files)に " +
				`${this.noteFolder} を追加すると、検索やクイックスイッチャーから除外できます` +
				"(Graph View には表示されたままになります)。",
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
