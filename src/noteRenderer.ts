import type { StoredCluster, StoredSession } from "./types";
import type { Locale } from "./i18n";

/**
 * ノート本文(Markdown)の生成。Obsidian API に依存しない純関数群。
 * frontmatter `generated: true` のノートのみプラグインが上書きする(設計書 §5)。
 */

const FORBIDDEN_FILE_CHARS = /[\\/:*?"<>|#^[\]]/g;

export function sanitizeFileName(s: string): string {
	return s.replace(FORBIDDEN_FILE_CHARS, " ").replace(/\s+/g, " ").trim();
}

/** タグに使える形へ(空白・記号を '-' に) */
export function sanitizeTag(s: string): string {
	return s
		.replace(/[\\/:*?"<>|#^[\]\s.,、。]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 32);
}

const MAX_TITLE_LEN = 40;

/** 先頭プロンプトから短い日本語タイトルを生成する(設計書 §5.1) */
export function makeTitle(prompt: string | null, sessionId: string, locale: Locale = "ja"): string {
	const base = (prompt ?? "").split("\n")[0];
	const cleaned = sanitizeFileName(base.replace(/[`*_>]/g, "").replace(/\s+/g, " ")).trim();
	if (cleaned.length === 0) {
		return `${locale === "ja" ? "セッション" : "Session"} ${sessionId.slice(0, 8)}`;
	}
	return cleaned.length > MAX_TITLE_LEN ? cleaned.slice(0, MAX_TITLE_LEN) : cleaned;
}

export function dateStrOf(iso: string | null): string {
	if (iso && /^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
	return "0000-00-00";
}

const MAX_SUMMARY_LEN = 200;

/** 先頭プロンプト・末尾の結果・変更内容から構造化概要を生成する。 */
export function makeSummary(
	prompt: string | null,
	lastAssistant: string | null,
	commands: string[] = [],
	files: string[] = [],
	locale: Locale = "ja",
): string {
	const lines: string[] = [];
	const labels =
		locale === "ja"
			? {
					goal: "目的",
					result: "結果",
					files: "主な変更",
					command: "主なコマンド",
					status: "状態",
				}
			: {
					goal: "Goal",
					result: "Outcome",
					files: "Key changes",
					command: "Main command",
					status: "Status",
				};
	if (prompt) {
		const p = prompt.replace(/\s+/g, " ").trim();
		lines.push(
			`- **${labels.goal}:** ` +
				(p.length > MAX_SUMMARY_LEN ? p.slice(0, MAX_SUMMARY_LEN) + "…" : p),
		);
	}
	if (lastAssistant) {
		const a = lastAssistant.replace(/\s+/g, " ").trim();
		lines.push(
			`- **${labels.result}:** ` +
				(a.length > MAX_SUMMARY_LEN ? a.slice(0, MAX_SUMMARY_LEN) + "…" : a),
		);
	}
	lines.push(
		`- **${labels.status}:** ${
			lastAssistant
				? locale === "ja"
					? "最終回答あり"
					: "Final response recorded"
				: locale === "ja"
					? "最終回答なし"
					: "No final response recorded"
		}`,
	);
	if (files.length > 0) {
		lines.push(
			`- **${labels.files}:** ${files
				.slice(0, 8)
				.map((f) => `\`${f.replace(/`/g, "'")}\``)
				.join(", ")}`,
		);
	}
	if (commands.length > 0) {
		lines.push(`- **${labels.command}:** \`${commands[0].replace(/`/g, "'")}\``);
	}
	return lines.join("\n");
}

function noteLabels(locale: Locale) {
	return locale === "ja"
		? {
				prompt: "プロンプト",
				summary: "概要",
				commands: "実行コマンド",
				related: "関連セッション",
				cluster: "クラスタ",
				members: "所属セッション",
				pattern: "共通パターン（Skill候補の素材）",
				noMaterial: "（素材なし）",
				recent: "候補評価",
				lifetime: "全期間",
				days: "日以内",
				duplicate: "重複候補",
			}
		: {
				prompt: "Prompt",
				summary: "Summary",
				commands: "Commands",
				related: "Related sessions",
				cluster: "Cluster",
				members: "Sessions",
				pattern: "Common pattern (skill candidate material)",
				noMaterial: "(No material)",
				recent: "Candidate activity",
				lifetime: "all time",
				days: "days",
				duplicate: "Possible duplicate",
			};
}

function yamlStr(s: string): string {
	return JSON.stringify(s);
}

function yamlList(items: string[]): string {
	return "[" + items.map(yamlStr).join(", ") + "]";
}

const MAX_FRONTMATTER_FILES = 20;
const MAX_PROMPT_QUOTE_LEN = 300;

export interface RelatedLink {
	noteBasename: string;
}

export function noteBasename(notePath: string): string {
	const name = notePath.split("/").pop() ?? notePath;
	return name.replace(/\.md$/, "");
}

export function renderSessionNote(
	s: StoredSession,
	related: RelatedLink[],
	cluster: { clusterId: string; notePath: string } | null,
	locale: Locale = "ja",
): string {
	const labels = noteLabels(locale);
	const tags = ["agent-session"];
	if (cluster) tags.push(`cluster/${sanitizeTag(cluster.clusterId)}`);

	const fm: string[] = [
		"---",
		"type: agent-session",
		`source: ${s.source}`,
		`session_id: ${yamlStr(s.sessionId)}`,
	];
	if (s.startedAt) fm.push(`started: ${yamlStr(s.startedAt)}`);
	if (s.endedAt) fm.push(`ended: ${yamlStr(s.endedAt)}`);
	if (s.cwd) fm.push(`cwd: ${yamlStr(s.cwd)}`);
	if (s.repo) fm.push(`repo: ${yamlStr(s.repo)}`);
	fm.push(`turns: ${s.turns}`);
	if (s.files.length > 0) {
		fm.push(`files: ${yamlList(s.files.slice(0, MAX_FRONTMATTER_FILES))}`);
	}
	if (cluster) fm.push(`cluster: ${yamlStr(cluster.clusterId)}`);
	if (s.duplicateOf) fm.push(`duplicate_of: ${yamlStr(s.duplicateOf)}`);
	fm.push(`language: ${locale}`);
	fm.push(`tags: [${tags.join(", ")}]`);
	fm.push("generated: true");
	fm.push("---");

	const identity = [s.source, s.sessionId.slice(0, 12), s.startedAt?.slice(0, 19)]
		.filter((value): value is string => !!value)
		.join(" · ");
	const body: string[] = ["", `# ${s.title}`, "", `> ${identity}`, ""];

	if (s.prompt) {
		const p = s.prompt.replace(/\s+/g, " ").trim();
		const quoted = p.length > MAX_PROMPT_QUOTE_LEN ? p.slice(0, MAX_PROMPT_QUOTE_LEN) + "…" : p;
		body.push(`## ${labels.prompt}`, `> ${quoted}`, "");
	}

	if (s.summary) {
		body.push(`## ${labels.summary}`, s.summary, "");
	}
	if (s.duplicateOf) {
		body.push(`> [!warning] ${labels.duplicate}: \`${s.duplicateOf}\``, "");
	}

	if (s.commands.length > 0) {
		body.push(`## ${labels.commands}`);
		for (const c of s.commands.slice(0, 20)) body.push(`- \`${c.replace(/`/g, "'")}\``);
		body.push("");
	}

	if (related.length > 0) {
		body.push(`## ${labels.related}`);
		for (const r of related) body.push(`- [[${r.noteBasename}]]`);
		body.push("");
	}

	if (cluster) {
		body.push(`## ${labels.cluster}`, `- [[${noteBasename(cluster.notePath)}]]`, "");
	}

	body.push(
		"```resume",
		`session_id: ${s.sessionId}`,
		`source: ${s.source}`,
		`cwd: ${s.cwd ?? ""}`,
		"```",
		"",
	);

	return fm.join("\n") + "\n" + body.join("\n");
}

export function renderClusterNote(
	c: StoredCluster,
	sessions: StoredSession[],
	commonPattern: string,
	locale: Locale = "ja",
): string {
	const labels = noteLabels(locale);
	const tags = ["agent-cluster"];
	if (c.skillStatus === "candidate") tags.push("skill-candidate");

	const fm: string[] = [
		"---",
		"type: agent-cluster",
		`cluster_id: ${yamlStr(c.clusterId)}`,
		`sessions: ${sessions.length}`,
		`recent_sessions: ${c.recentMembers?.length ?? sessions.length}`,
		`candidate_window_days: ${c.candidateWindowDays ?? 0}`,
		`candidate_density: ${(c.candidateDensity ?? 0).toFixed(3)}`,
		`skill_status: ${c.skillStatus}`,
		`language: ${locale}`,
		`tags: [${tags.join(", ")}]`,
		"generated: true",
		"---",
	];

	const windowText =
		(c.candidateWindowDays ?? 0) > 0
			? `${c.recentMembers?.length ?? 0} / ${c.candidateWindowDays} ${labels.days}; ${sessions.length} ${labels.lifetime}`
			: `${sessions.length} ${labels.lifetime}`;
	const body: string[] = [
		"",
		`# ${c.name}`,
		"",
		`> **${labels.recent}:** ${windowText}`,
		"",
		`## ${labels.members}`,
	];
	const sorted = [...sessions].sort((a, b) =>
		(a.startedAt ?? "").localeCompare(b.startedAt ?? ""),
	);
	const latestActivity = [...sorted].reverse().find((session) => session.startedAt)?.startedAt;
	if (latestActivity) {
		fm.splice(fm.length - 3, 0, `latest_activity: ${yamlStr(latestActivity)}`);
		body.splice(
			5,
			0,
			`> **${locale === "ja" ? "最終活動" : "Latest activity"}: ${latestActivity}`,
			"",
		);
	}
	for (const s of sorted) body.push(`- [[${noteBasename(s.notePath)}]]`);
	body.push("");

	body.push(`## ${labels.pattern}`);
	body.push(commonPattern.length > 0 ? commonPattern : labels.noMaterial);
	body.push("");

	body.push("```skill-promote", `cluster_id: ${c.clusterId}`, "```", "");

	return fm.join("\n") + "\n" + body.join("\n");
}

/** 頻度集計ベースの共通パターン列挙(Ollama 無効時のフォールバック、設計書 §5.2/§8) */
export function summarizeCommonPatterns(sessions: StoredSession[], locale: Locale = "ja"): string {
	const lines: string[] = [];
	const half = Math.max(2, Math.ceil(sessions.length / 2));

	const cmdFreq = new Map<string, number>();
	for (const s of sessions) {
		for (const c of new Set(s.commands)) {
			cmdFreq.set(c, (cmdFreq.get(c) ?? 0) + 1);
		}
	}
	const commonCmds = [...cmdFreq.entries()]
		.filter(([, n]) => n >= half)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10);
	if (commonCmds.length > 0) {
		lines.push(locale === "ja" ? "共通して実行されたコマンド:" : "Common commands:");
		for (const [c, n] of commonCmds)
			lines.push(`- \`${c.replace(/`/g, "'")}\` (${n}/${sessions.length})`);
	}

	const repos = new Map<string, number>();
	for (const s of sessions) {
		if (s.repo) repos.set(s.repo, (repos.get(s.repo) ?? 0) + 1);
	}
	if (repos.size > 0) {
		lines.push(
			(locale === "ja" ? "対象リポジトリ: " : "Repositories: ") +
				[...repos.entries()]
					.sort((a, b) => b[1] - a[1])
					.map(([r, n]) => `${r} (${n})`)
					.join(", "),
		);
	}
	return lines.join("\n");
}

/** クラスタブリーフ(Codex skill-creator に渡す素材、設計書 §8) */
export function renderBrief(
	c: StoredCluster,
	sessions: StoredSession[],
	commonPattern: string,
	locale: Locale = "ja",
): string {
	const sorted = [...sessions].sort((a, b) =>
		(a.startedAt ?? "").localeCompare(b.startedAt ?? ""),
	);

	const ja = locale === "ja";
	const lines: string[] = [
		"---",
		"type: agent-skill-brief",
		`cluster_id: ${yamlStr(c.clusterId)}`,
		`sessions: ${sessions.length}`,
		`language: ${locale}`,
		"generated: true",
		"---",
		"",
		`# ${ja ? "Skill化ブリーフ" : "Skill brief"}: ${c.name}`,
		"",
		ja
			? "このファイルは Agent Constellation が最近の類似セッション群から自動生成した、skill-creator 用の素材です。"
			: "Agent Constellation generated this material from a recent group of similar sessions for skill-creator.",
		"",
		`## ${ja ? "共通パターン" : "Common pattern"}`,
		commonPattern.length > 0
			? commonPattern
			: ja
				? "（自動抽出なし。各セッションのプロンプトから判断してください）"
				: "(No automatic extraction. Infer the pattern from the prompts below.)",
		"",
		`## ${ja ? "各セッションのプロンプト" : "Session prompts"}`,
	];

	for (const s of sorted) {
		lines.push("", `### ${dateStrOf(s.startedAt)} ${s.title}`);
		if (s.repo || s.cwd) lines.push(`- ${ja ? "対象" : "Target"}: ${s.repo ?? s.cwd}`);
		for (const [i, msg] of splitPrompts(s).entries()) {
			lines.push("", `${ja ? "プロンプト" : "Prompt"} ${i + 1}:`, "", fencedText(msg));
		}
		if (s.commands.length > 0) {
			lines.push("", ja ? "実行コマンド:" : "Commands:");
			for (const cmd of s.commands.slice(0, 15))
				lines.push(`- \`${cmd.replace(/`/g, "'")}\``);
		}
		if (s.files.length > 0) {
			lines.push(
				"",
				(ja ? "変更ファイル: " : "Changed files: ") + s.files.slice(0, 15).join(", "),
			);
		}
	}

	lines.push(
		"",
		`## ${ja ? "セッション間で異なっていた部分（パラメータ候補）" : "Differences between sessions (parameter candidates)"}`,
		variableParts(sorted, locale),
		"",
	);
	return lines.join("\n");
}

function splitPrompts(s: StoredSession): string[] {
	// text はユーザー発話を "\n\n---\n\n" 区切りで連結して保存している
	return s.text
		.split("\n\n---\n\n")
		.filter((t) => t.trim().length > 0)
		.slice(0, 5);
}

function variableParts(sessions: StoredSession[], locale: Locale): string {
	const ja = locale === "ja";
	const lines: string[] = [];
	const repos = new Set(sessions.map((s) => s.repo ?? s.cwd ?? (ja ? "（不明）" : "(unknown)")));
	if (repos.size > 1) {
		lines.push(
			`- ${ja ? "対象リポジトリ/ディレクトリが異なる" : "Repository or directory varies"}: ${[...repos].join(", ")}`,
		);
	}
	const uncommon = new Map<string, number>();
	const half = Math.max(2, Math.ceil(sessions.length / 2));
	const freq = new Map<string, number>();
	for (const s of sessions) {
		for (const c of new Set(s.commands)) freq.set(c, (freq.get(c) ?? 0) + 1);
	}
	for (const [c, n] of freq) if (n < half) uncommon.set(c, n);
	if (uncommon.size > 0) {
		lines.push(
			ja
				? "- 一部のセッションのみで実行されたコマンド（可変部分の候補）:"
				: "- Commands used only in some sessions (possible variables):",
		);
		for (const [c] of [...uncommon.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
			lines.push(`  - \`${c.replace(/`/g, "'")}\``);
		}
	}
	return lines.length > 0
		? lines.join("\n")
		: ja
			? "（顕著な差分は検出されませんでした）"
			: "(No significant differences detected.)";
}

function fencedText(text: string): string {
	const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
	const fence = "`".repeat(Math.max(3, longest + 1));
	return `${fence}\n${text}\n${fence}`;
}
