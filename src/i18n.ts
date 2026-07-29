/**
 * UI 文字列の英日対応。
 * Obsidian が localStorage("language") に保存する表示言語に従い、
 * 日本語なら日本語、それ以外は英語を返す。
 * 生成ノートの本文は設計方針(日本語前提)のまま変更しない。
 */

type Locale = "en" | "ja";

function detectLocale(): Locale {
	try {
		if (typeof window !== "undefined" && window.localStorage) {
			return window.localStorage.getItem("language") === "ja" ? "ja" : "en";
		}
	} catch {
		// localStorage 不可(テスト環境等)は英語
	}
	return "en";
}

const STRINGS = {
	// コマンド・リボン
	"cmd.scan": {
		en: "Import sessions (scan)",
		ja: "セッションを取り込む(スキャン)",
	},
	"cmd.rebuild": { en: "Rebuild all notes", ja: "ノートを全再生成" },
	"cmd.resume": { en: "Resume this session", ja: "このセッションを再開" },
	"cmd.setupGuide": { en: "Show setup guide", ja: "セットアップガイドを表示" },
	"ribbon.scan": {
		en: "Agent Constellation: Import sessions",
		ja: "Agent Constellation: セッションを取り込む",
	},

	// ボタン
	"btn.resume": { en: "▶ Resume this session", ja: "▶ このセッションを再開" },
	"btn.promote": {
		en: "🚀 Promote to skill via Codex",
		ja: "🚀 Codex に渡して Skill 化",
	},
	"btn.brief": { en: "📄 Generate brief only", ja: "📄 ブリーフのみ生成" },
	"btn.markPromoted": { en: "✅ Mark as promoted", ja: "✅ promoted にする" },
	"busy.launching": { en: "⏳ Launching…", ja: "⏳ 起動中…" },
	"busy.generatingBrief": { en: "⏳ Generating brief…", ja: "⏳ ブリーフ生成中…" },
	"busy.generating": { en: "⏳ Generating…", ja: "⏳ 生成中…" },
	"busy.updating": { en: "⏳ Updating…", ja: "⏳ 更新中…" },
	"notice.buttonFailed": {
		en: "Agent Constellation: operation failed: {msg}",
		ja: "Agent Constellation: 処理に失敗しました: {msg}",
	},

	// スキャン・エンジン
	"notice.notImportHost": {
		en: "Agent Constellation: this machine is not the import host (host: {host}). Browsing and resume are still available.",
		ja: "Agent Constellation: このマシンは取り込み担当ではありません(担当: {host})。閲覧と resume のみ利用できます。",
	},
	"notice.noNewSessions": {
		en: "Agent Constellation: no new sessions.",
		ja: "Agent Constellation: 新しいセッションはありません。",
	},
	"notice.scanFailed": {
		en: "Agent Constellation: scan failed (ledger rolled back): {msg}",
		ja: "Agent Constellation: スキャンに失敗しました(台帳は巻き戻しました): {msg}",
	},
	"notice.importing": {
		en: "Agent Constellation: importing… ({n}/{total})",
		ja: "Agent Constellation: 取り込み中… ({n}/{total})",
	},
	"notice.computing": {
		en: "Agent Constellation: computing links and clusters…",
		ja: "Agent Constellation: リンク・クラスタを計算中…",
	},
	"notice.imported": {
		en: "Agent Constellation: imported {n} sessions ({total} total).",
		ja: "Agent Constellation: {n} 件のセッションを取り込みました(全 {total} 件)。",
	},
	"notice.ollamaFallback": {
		en: "Agent Constellation: cannot reach Ollama; falling back to TF-IDF (L2).",
		ja: "Agent Constellation: Ollama に接続できないため、TF-IDF(L2)で計算します。",
	},

	// Resume
	"notice.noSessionId": {
		en: "session_id not found.",
		ja: "session_id が見つかりません。",
	},
	"notice.noSessionFile": {
		en: "The session file does not exist on this machine. Resume it on the machine where the session ran.",
		ja: "このマシンにはセッションの実体が見つかりません。セッションを実行したマシンで再開してください。",
	},
	"notice.copied": {
		en: "Command copied to clipboard.",
		ja: "コマンドをクリップボードにコピーしました。",
	},
	"modal.missingCwd.title": {
		en: "Working directory not found",
		ja: "作業ディレクトリが見つかりません",
	},
	"modal.missingCwd.body": {
		en: "The original working directory {cwd} no longer exists. What would you like to do?",
		ja: "元の作業ディレクトリ {cwd} は存在しません。どうしますか?",
	},
	"modal.missingCwd.home": {
		en: "Resume in home directory",
		ja: "ホームディレクトリで再開",
	},
	"modal.missingCwd.copy": { en: "Copy command only", ja: "コマンドをコピーのみ" },
	"modal.missingCwd.cancel": { en: "Cancel", ja: "キャンセル" },

	// ターミナル
	"notice.macOnly": {
		en: "Launching a terminal is only supported on macOS. Command copied to clipboard.",
		ja: "ターミナル起動は macOS のみ対応です。コマンドをクリップボードにコピーしました。",
	},
	"notice.terminalFailed": {
		en: "Failed to launch Terminal.app; command copied to clipboard.",
		ja: "Terminal.app の起動に失敗したため、コマンドをクリップボードにコピーしました。",
	},
	"notice.ghosttyFallback": {
		en: "Failed to launch Ghostty with the command; it was copied to the clipboard. Paste it into Ghostty to run.",
		ja: "Ghostty のコマンド付き起動に失敗したため、コマンドをクリップボードにコピーしました。Ghostty に貼り付けて実行してください。",
	},

	// Skill 化
	"notice.clusterNotFoundRescan": {
		en: "Cluster {id} not found. Please rescan.",
		ja: "クラスタ {id} が見つかりません。再スキャンしてください。",
	},
	"notice.clusterNotFound": {
		en: "Cluster {id} not found.",
		ja: "クラスタ {id} が見つかりません。",
	},
	"notice.briefCreated": {
		en: "Brief generated: {path}",
		ja: "ブリーフを生成しました: {path}",
	},
	"notice.markedPromoted": {
		en: "Cluster “{name}” marked as promoted.",
		ja: "クラスタ「{name}」を promoted にしました。",
	},

	// セットアップガイド
	"setup.title": {
		en: "Agent Constellation setup guide",
		ja: "Agent Constellation セットアップガイド",
	},
	"setup.intro": {
		en: "Run “Import sessions (scan)” from the command palette to turn Codex CLI / Claude Code sessions into notes under {folder}/.",
		ja: "コマンドパレットの「セッションを取り込む(スキャン)」で Codex CLI / Claude Code のセッションが {folder}/ 配下のノートになります。",
	},
	"setup.graphHeading": {
		en: "Recommended graph view settings",
		ja: "Graph View の推奨設定",
	},
	"setup.graphFilter": {
		en: "Filter: path:{folder} (to show only the constellation)",
		ja: "フィルタ: path:{folder} (星座だけを表示したい場合)",
	},
	"setup.graphGroupSession": {
		en: "Group: tag:#agent-session → gray",
		ja: "グループ: tag:#agent-session → 灰色",
	},
	"setup.graphGroupCluster": {
		en: "Group: path:{folder}/clusters → blue (cluster hubs)",
		ja: "グループ: path:{folder}/clusters → 青(クラスタハブ)",
	},
	"setup.graphGroupCandidate": {
		en: "Group: tag:#skill-candidate → yellow (skill candidates light up)",
		ja: "グループ: tag:#skill-candidate → 黄(Skill 候補が光る)",
	},
	"setup.excludeHeading": {
		en: "If the folder gets in the way",
		ja: "フォルダが邪魔な場合",
	},
	"setup.excludeBody": {
		en: "Add {folder} to Settings → Files and links → Excluded files to hide it from search and the quick switcher (it stays visible in the graph view).",
		ja: "設定 → ファイルとリンク → 除外ファイル(Excluded files)に {folder} を追加すると、検索やクイックスイッチャーから除外できます(Graph View には表示されたままになります)。",
	},

	// 設定タブ
	"settings.heading.notes": { en: "Notes", ja: "ノート" },
	"settings.noteFolder.name": { en: "Note folder", ja: "ノートフォルダ名" },
	"settings.noteFolder.desc": {
		en: "Folder in the vault for session and cluster notes",
		ja: "セッションノート・クラスタノートを置く Vault 内フォルダ",
	},
	"settings.heading.import": { en: "Import", ja: "取り込み" },
	"settings.codexDir.name": {
		en: "Codex sessions directory",
		ja: "Codex セッションディレクトリ",
	},
	"settings.codexDir.desc": {
		en: "Location of rollout-*.jsonl (default: ~/.codex/sessions)",
		ja: "rollout-*.jsonl の置き場所(既定: ~/.codex/sessions)",
	},
	"settings.claudeDir.name": {
		en: "Claude Code sessions directory",
		ja: "Claude Code セッションディレクトリ",
	},
	"settings.claudeDir.desc": {
		en: "Location of <uuid>.jsonl (default: ~/.claude/projects)",
		ja: "<uuid>.jsonl の置き場所(既定: ~/.claude/projects)",
	},
	"settings.scanInterval.name": {
		en: "Auto scan interval (minutes)",
		ja: "自動スキャン間隔(分)",
	},
	"settings.scanInterval.desc": {
		en: "0 to disable. Scanning at startup and via the command palette is always available",
		ja: "0 で無効。起動時と手動コマンドでのスキャンは常に可能",
	},
	"settings.watch.name": { en: "Watch files", ja: "ファイル監視" },
	"settings.watch.desc": {
		en: "Watch the session directories and import new sessions automatically",
		ja: "セッションディレクトリを監視し、新規セッションを自動で取り込む",
	},
	"settings.importHost.name": { en: "Import host", ja: "取り込み担当マシン" },
	"settings.importHost.desc": {
		en: "Prevents double imports when the vault is synced across machines. Only the machine whose hostname is recorded here runs imports (empty = set automatically on first import)",
		ja: "Vault を複数マシンで同期している場合の二重取り込み防止。ここに記録されたホスト名のマシンだけが取り込みを実行する(空 = 初回取り込み時に自動設定)",
	},
	"settings.importHost.placeholder": { en: "(not set)", ja: "(未設定)" },
	"settings.importHost.useThis": {
		en: "Use this machine",
		ja: "このマシンを担当にする",
	},
	"settings.heading.similarity": {
		en: "Similarity and clustering",
		ja: "類似度・クラスタ",
	},
	"settings.simLevel.name": {
		en: "Semantic similarity method",
		ja: "意味的類似度の方式",
	},
	"settings.simLevel.desc": {
		en: "L2: character bi-gram TF-IDF (no dependencies) / L3: Ollama embeddings (higher accuracy)",
		ja: "L2: 文字 bi-gram TF-IDF(依存なし)/ L3: Ollama embedding(高精度)",
	},
	"settings.simLevel.l2": { en: "L2: TF-IDF (default)", ja: "L2: TF-IDF(既定)" },
	"settings.simLevel.l3": { en: "L3: Ollama embeddings", ja: "L3: Ollama embedding" },
	"settings.ollamaEndpoint.name": { en: "Ollama endpoint", ja: "Ollama エンドポイント" },
	"settings.ollamaEmbed.name": {
		en: "Ollama embedding model",
		ja: "Ollama embedding モデル",
	},
	"settings.ollamaEmbed.desc": {
		en: "Multilingual model recommended (e.g. bge-m3)",
		ja: "多言語モデル推奨(例: bge-m3)",
	},
	"settings.ollamaChat.name": {
		en: "Ollama naming/summary model",
		ja: "Ollama 命名・要約モデル",
	},
	"settings.ollamaChat.desc": {
		en: "Small local LLM used to name clusters and summarize common patterns",
		ja: "クラスタ名・共通パターンの生成に使う小型ローカルLLM",
	},
	"settings.linkThreshold.name": { en: "Link threshold", ja: "リンク閾値" },
	"settings.linkThreshold.desc": {
		en: "Link sessions whose combined score is at or above this value (0-1, default 0.35)",
		ja: "合成スコアがこの値以上のセッション同士にリンクを張る(0〜1、既定 0.35)",
	},
	"settings.skillThreshold.name": {
		en: "Skill candidate threshold",
		ja: "Skill 候補化の閾値",
	},
	"settings.skillThreshold.desc": {
		en: "Mark a cluster as a skill candidate when it reaches this many sessions",
		ja: "クラスタの所属セッション数がこの値に達すると Skill 候補として提示する",
	},
	"settings.heading.actions": { en: "Resume and skills", ja: "Resume・Skill 化" },
	"settings.terminal.name": { en: "Terminal", ja: "ターミナル" },
	"settings.terminal.desc": {
		en: "Terminal used for resume and skill promotion",
		ja: "resume・Skill 化で使うターミナル",
	},
	"settings.terminal.terminalApp": {
		en: "Terminal.app (default)",
		ja: "Terminal.app(既定)",
	},
	"settings.terminal.ghostty": { en: "Ghostty", ja: "Ghostty" },
	"settings.terminal.clipboard": {
		en: "Copy command to clipboard only",
		ja: "コマンドをクリップボードにコピーのみ",
	},
	"settings.skillTemplate.name": {
		en: "Skill promotion command template",
		ja: "Skill 化コマンドのテンプレート",
	},
	"settings.skillTemplate.desc": {
		en: "{repo} = target directory, {brief} = absolute path of the brief",
		ja: "{repo} = 対象ディレクトリ、{brief} = ブリーフの絶対パス に置換される",
	},
} as const;

export type I18nKey = keyof typeof STRINGS;

let locale: Locale | null = null;

/** テスト用に上書き可能 */
export function setLocale(l: Locale | null): void {
	locale = l;
}

export function t(key: I18nKey, vars?: Record<string, string | number>): string {
	const l = locale ?? detectLocale();
	let text: string = STRINGS[key][l];
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			text = text.split(`{${k}}`).join(String(v));
		}
	}
	return text;
}
