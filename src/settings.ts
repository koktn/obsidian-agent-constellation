import { App, PluginSettingTab, Setting } from "obsidian";
import type AgentConstellationPlugin from "./main";

export type TerminalKind = "terminal" | "ghostty" | "clipboard";
export type SimilarityLevel = "l2" | "l3";

export interface ACSettings {
	noteFolder: string;
	codexSessionsDir: string;
	/** 自動スキャン間隔(分)。0 で無効 */
	autoScanIntervalMin: number;
	watchEnabled: boolean;
	similarityLevel: SimilarityLevel;
	ollamaEndpoint: string;
	ollamaEmbedModel: string;
	ollamaChatModel: string;
	linkThreshold: number;
	maxLinksPerNote: number;
	maxClusterSize: number;
	skillCandidateThreshold: number;
	terminal: TerminalKind;
	skillCommandTemplate: string;
	/** 取り込み担当マシン(空 = 初回取り込み時に自動設定) */
	importHostname: string;
	setupShown: boolean;
}

export const DEFAULT_SETTINGS: ACSettings = {
	noteFolder: "_Constellation",
	codexSessionsDir: "~/.codex/sessions",
	autoScanIntervalMin: 30,
	watchEnabled: false,
	similarityLevel: "l2",
	ollamaEndpoint: "http://localhost:11434",
	ollamaEmbedModel: "bge-m3",
	ollamaChatModel: "gemma4:e4b-mlx",
	linkThreshold: 0.35,
	maxLinksPerNote: 5,
	maxClusterSize: 40,
	skillCandidateThreshold: 5,
	terminal: "terminal",
	skillCommandTemplate:
		'cd {repo} && codex "skill-creator を使って、次のファイルにまとめた繰り返しパターンを skill 化して: {brief}"',
	importHostname: "",
	setupShown: false,
};

export class ACSettingTab extends PluginSettingTab {
	plugin: AgentConstellationPlugin;

	constructor(app: App, plugin: AgentConstellationPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const save = () => this.plugin.saveSettings();
		const s = this.plugin.settings;

		new Setting(containerEl).setName("ノート").setHeading();

		new Setting(containerEl)
			.setName("ノートフォルダ名")
			.setDesc("セッションノート・クラスタノートを置く Vault 内フォルダ")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.noteFolder)
					.setValue(s.noteFolder)
					.onChange(async (v) => {
						s.noteFolder = v.trim() || DEFAULT_SETTINGS.noteFolder;
						await save();
					})
			);

		new Setting(containerEl).setName("取り込み").setHeading();

		new Setting(containerEl)
			.setName("Codex セッションディレクトリ")
			.setDesc("rollout-*.jsonl の置き場所(既定: ~/.codex/sessions)")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.codexSessionsDir)
					.setValue(s.codexSessionsDir)
					.onChange(async (v) => {
						s.codexSessionsDir = v.trim() || DEFAULT_SETTINGS.codexSessionsDir;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("自動スキャン間隔(分)")
			.setDesc("0 で無効。起動時と手動コマンドでのスキャンは常に可能")
			.addText((t) =>
				t.setValue(String(s.autoScanIntervalMin)).onChange(async (v) => {
					const n = Number(v);
					s.autoScanIntervalMin = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
					await save();
					this.plugin.restartAutoScan();
				})
			);

		new Setting(containerEl)
			.setName("ファイル監視")
			.setDesc("セッションディレクトリを監視し、新規セッションを自動で取り込む")
			.addToggle((t) =>
				t.setValue(s.watchEnabled).onChange(async (v) => {
					s.watchEnabled = v;
					await save();
					this.plugin.restartWatcher();
				})
			);

		new Setting(containerEl)
			.setName("取り込み担当マシン")
			.setDesc(
				"Vault を複数マシンで同期している場合の二重取り込み防止。" +
					"ここに記録されたホスト名のマシンだけが取り込みを実行する(空 = 初回取り込み時に自動設定)"
			)
			.addText((t) =>
				t.setPlaceholder("(未設定)")
					.setValue(s.importHostname)
					.onChange(async (v) => {
						s.importHostname = v.trim();
						await save();
					})
			)
			.addExtraButton((b) =>
				b.setIcon("laptop")
					.setTooltip("このマシンを担当にする")
					.onClick(async () => {
						s.importHostname = this.plugin.hostname();
						await save();
						this.display();
					})
			);

		new Setting(containerEl).setName("類似度・クラスタ").setHeading();

		new Setting(containerEl)
			.setName("意味的類似度の方式")
			.setDesc("L2: 文字 bi-gram TF-IDF(依存なし)/ L3: Ollama embedding(高精度)")
			.addDropdown((d) =>
				d.addOption("l2", "L2: TF-IDF(既定)")
					.addOption("l3", "L3: Ollama embedding")
					.setValue(s.similarityLevel)
					.onChange(async (v) => {
						s.similarityLevel = v === "l3" ? "l3" : "l2";
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Ollama エンドポイント")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.ollamaEndpoint)
					.setValue(s.ollamaEndpoint)
					.onChange(async (v) => {
						s.ollamaEndpoint = v.trim() || DEFAULT_SETTINGS.ollamaEndpoint;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Ollama embedding モデル")
			.setDesc("多言語モデル推奨(例: bge-m3)")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.ollamaEmbedModel)
					.setValue(s.ollamaEmbedModel)
					.onChange(async (v) => {
						s.ollamaEmbedModel = v.trim() || DEFAULT_SETTINGS.ollamaEmbedModel;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Ollama 命名・要約モデル")
			.setDesc("クラスタ名・共通パターンの生成に使う小型ローカルLLM")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.ollamaChatModel)
					.setValue(s.ollamaChatModel)
					.onChange(async (v) => {
						s.ollamaChatModel = v.trim() || DEFAULT_SETTINGS.ollamaChatModel;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("リンク閾値")
			.setDesc("合成スコアがこの値以上のセッション同士にリンクを張る(0〜1、既定 0.35)")
			.addText((t) =>
				t.setValue(String(s.linkThreshold)).onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n > 0 && n <= 1) {
						s.linkThreshold = n;
						await save();
					}
				})
			);

		new Setting(containerEl)
			.setName("Skill 候補化の閾値")
			.setDesc("クラスタの所属セッション数がこの値に達すると Skill 候補として提示する")
			.addText((t) =>
				t.setValue(String(s.skillCandidateThreshold)).onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n >= 2) {
						s.skillCandidateThreshold = Math.floor(n);
						await save();
					}
				})
			);

		new Setting(containerEl).setName("Resume・Skill 化").setHeading();

		new Setting(containerEl)
			.setName("ターミナル")
			.setDesc("resume・Skill 化で使うターミナル")
			.addDropdown((d) =>
				d.addOption("terminal", "Terminal.app(既定)")
					.addOption("ghostty", "Ghostty")
					.addOption("clipboard", "コマンドをクリップボードにコピーのみ")
					.setValue(s.terminal)
					.onChange(async (v) => {
						s.terminal =
							v === "ghostty" ? "ghostty" : v === "clipboard" ? "clipboard" : "terminal";
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Skill 化コマンドのテンプレート")
			.setDesc("{repo} = 対象ディレクトリ、{brief} = ブリーフの絶対パス に置換される")
			.addTextArea((t) =>
				t.setValue(s.skillCommandTemplate).onChange(async (v) => {
					s.skillCommandTemplate = v.trim() || DEFAULT_SETTINGS.skillCommandTemplate;
					await save();
				})
			);
	}
}
