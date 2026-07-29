import { App, PluginSettingTab, Setting } from "obsidian";
import type AgentConstellationPlugin from "./main";
import { t } from "./i18n";

export type TerminalKind = "terminal" | "ghostty" | "clipboard";
export type SimilarityLevel = "l2" | "l3";

export interface ACSettings {
	noteFolder: string;
	codexSessionsDir: string;
	claudeSessionsDir: string;
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
	claudeSessionsDir: "~/.claude/projects",
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

		new Setting(containerEl).setName(t("settings.heading.notes")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.noteFolder.name"))
			.setDesc(t("settings.noteFolder.desc"))
			.addText((tx) =>
				tx.setPlaceholder(DEFAULT_SETTINGS.noteFolder)
					.setValue(s.noteFolder)
					.onChange(async (v) => {
						s.noteFolder = v.trim() || DEFAULT_SETTINGS.noteFolder;
						await save();
					})
			);

		new Setting(containerEl).setName(t("settings.heading.import")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.codexDir.name"))
			.setDesc(t("settings.codexDir.desc"))
			.addText((tx) =>
				tx.setPlaceholder(DEFAULT_SETTINGS.codexSessionsDir)
					.setValue(s.codexSessionsDir)
					.onChange(async (v) => {
						s.codexSessionsDir = v.trim() || DEFAULT_SETTINGS.codexSessionsDir;
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.claudeDir.name"))
			.setDesc(t("settings.claudeDir.desc"))
			.addText((tx) =>
				tx.setPlaceholder(DEFAULT_SETTINGS.claudeSessionsDir)
					.setValue(s.claudeSessionsDir)
					.onChange(async (v) => {
						s.claudeSessionsDir = v.trim() || DEFAULT_SETTINGS.claudeSessionsDir;
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.scanInterval.name"))
			.setDesc(t("settings.scanInterval.desc"))
			.addText((tx) =>
				tx.setValue(String(s.autoScanIntervalMin)).onChange(async (v) => {
					const n = Number(v);
					s.autoScanIntervalMin = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
					await save();
					this.plugin.restartAutoScan();
				})
			);

		new Setting(containerEl)
			.setName(t("settings.watch.name"))
			.setDesc(t("settings.watch.desc"))
			.addToggle((tg) =>
				tg.setValue(s.watchEnabled).onChange(async (v) => {
					s.watchEnabled = v;
					await save();
					this.plugin.restartWatcher();
				})
			);

		new Setting(containerEl)
			.setName(t("settings.importHost.name"))
			.setDesc(t("settings.importHost.desc"))
			.addText((tx) =>
				tx.setPlaceholder(t("settings.importHost.placeholder"))
					.setValue(s.importHostname)
					.onChange(async (v) => {
						s.importHostname = v.trim();
						await save();
					})
			)
			.addExtraButton((b) =>
				b.setIcon("laptop")
					.setTooltip(t("settings.importHost.useThis"))
					.onClick(async () => {
						s.importHostname = this.plugin.hostname();
						await save();
						this.display();
					})
			);

		new Setting(containerEl).setName(t("settings.heading.similarity")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.simLevel.name"))
			.setDesc(t("settings.simLevel.desc"))
			.addDropdown((d) =>
				d.addOption("l2", t("settings.simLevel.l2"))
					.addOption("l3", t("settings.simLevel.l3"))
					.setValue(s.similarityLevel)
					.onChange(async (v) => {
						s.similarityLevel = v === "l3" ? "l3" : "l2";
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.ollamaEndpoint.name"))
			.addText((tx) =>
				tx.setPlaceholder(DEFAULT_SETTINGS.ollamaEndpoint)
					.setValue(s.ollamaEndpoint)
					.onChange(async (v) => {
						s.ollamaEndpoint = v.trim() || DEFAULT_SETTINGS.ollamaEndpoint;
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.ollamaEmbed.name"))
			.setDesc(t("settings.ollamaEmbed.desc"))
			.addText((tx) =>
				tx.setPlaceholder(DEFAULT_SETTINGS.ollamaEmbedModel)
					.setValue(s.ollamaEmbedModel)
					.onChange(async (v) => {
						s.ollamaEmbedModel = v.trim() || DEFAULT_SETTINGS.ollamaEmbedModel;
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.ollamaChat.name"))
			.setDesc(t("settings.ollamaChat.desc"))
			.addText((tx) =>
				tx.setPlaceholder(DEFAULT_SETTINGS.ollamaChatModel)
					.setValue(s.ollamaChatModel)
					.onChange(async (v) => {
						s.ollamaChatModel = v.trim() || DEFAULT_SETTINGS.ollamaChatModel;
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.linkThreshold.name"))
			.setDesc(t("settings.linkThreshold.desc"))
			.addText((tx) =>
				tx.setValue(String(s.linkThreshold)).onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n > 0 && n <= 1) {
						s.linkThreshold = n;
						await save();
					}
				})
			);

		new Setting(containerEl)
			.setName(t("settings.skillThreshold.name"))
			.setDesc(t("settings.skillThreshold.desc"))
			.addText((tx) =>
				tx.setValue(String(s.skillCandidateThreshold)).onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n >= 2) {
						s.skillCandidateThreshold = Math.floor(n);
						await save();
					}
				})
			);

		new Setting(containerEl).setName(t("settings.heading.actions")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.terminal.name"))
			.setDesc(t("settings.terminal.desc"))
			.addDropdown((d) =>
				d.addOption("terminal", t("settings.terminal.terminalApp"))
					.addOption("ghostty", t("settings.terminal.ghostty"))
					.addOption("clipboard", t("settings.terminal.clipboard"))
					.setValue(s.terminal)
					.onChange(async (v) => {
						s.terminal =
							v === "ghostty" ? "ghostty" : v === "clipboard" ? "clipboard" : "terminal";
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.skillTemplate.name"))
			.setDesc(t("settings.skillTemplate.desc"))
			.addTextArea((tx) =>
				tx.setValue(s.skillCommandTemplate).onChange(async (v) => {
					s.skillCommandTemplate = v.trim() || DEFAULT_SETTINGS.skillCommandTemplate;
					await save();
				})
			);
	}
}
