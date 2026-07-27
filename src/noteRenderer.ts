import type { StoredCluster, StoredSession } from "./types";

/**
 * ノート本文(Markdown)の生成。Obsidian API に依存しない純関数群。
 * frontmatter `generated: true` のノートのみプラグインが上書きする(設計書 §5)。
 */

const FORBIDDEN_FILE_CHARS = /[\\/:*?"<>|#^[\]]/g;

export function sanitizeFileName(s: string): string {
	return s
		.replace(FORBIDDEN_FILE_CHARS, " ")
		.replace(/\s+/g, " ")
		.trim();
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
export function makeTitle(prompt: string | null, sessionId: string): string {
	const base = (prompt ?? "").split("\n")[0];
	const cleaned = sanitizeFileName(
		base.replace(/[`*_>]/g, "").replace(/\s+/g, " ")
	).trim();
	if (cleaned.length === 0) return `セッション ${sessionId.slice(0, 8)}`;
	return cleaned.length > MAX_TITLE_LEN
		? cleaned.slice(0, MAX_TITLE_LEN)
		: cleaned;
}

export function dateStrOf(iso: string | null): string {
	if (iso && /^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
	return "0000-00-00";
}

const MAX_SUMMARY_LEN = 200;

/** 先頭プロンプト+末尾の結果から機械生成する 2〜3 行の要約(設計書 §5.1) */
export function makeSummary(
	prompt: string | null,
	lastAssistant: string | null
): string {
	const lines: string[] = [];
	if (prompt) {
		const p = prompt.replace(/\s+/g, " ").trim();
		lines.push(
			"依頼: " + (p.length > MAX_SUMMARY_LEN ? p.slice(0, MAX_SUMMARY_LEN) + "…" : p)
		);
	}
	if (lastAssistant) {
		const a = lastAssistant.replace(/\s+/g, " ").trim();
		lines.push(
			"結果: " + (a.length > MAX_SUMMARY_LEN ? a.slice(0, MAX_SUMMARY_LEN) + "…" : a)
		);
	}
	return lines.join("\n");
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
	cluster: { clusterId: string; notePath: string } | null
): string {
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
	fm.push(`tags: [${tags.join(", ")}]`);
	fm.push("generated: true");
	fm.push("---");

	const body: string[] = ["", `# ${s.title}`, ""];

	if (s.prompt) {
		const p = s.prompt.replace(/\s+/g, " ").trim();
		const quoted = p.length > MAX_PROMPT_QUOTE_LEN ? p.slice(0, MAX_PROMPT_QUOTE_LEN) + "…" : p;
		body.push("## プロンプト", `> ${quoted}`, "");
	}

	if (s.summary) {
		body.push("## 概要", s.summary, "");
	}

	if (s.commands.length > 0) {
		body.push("## 実行コマンド");
		for (const c of s.commands.slice(0, 20)) body.push(`- \`${c.replace(/`/g, "'")}\``);
		body.push("");
	}

	if (related.length > 0) {
		body.push("## 関連セッション");
		for (const r of related) body.push(`- [[${r.noteBasename}]]`);
		body.push("");
	}

	if (cluster) {
		body.push("## クラスタ", `- [[${noteBasename(cluster.notePath)}]]`, "");
	}

	body.push(
		"```resume",
		`session_id: ${s.sessionId}`,
		`cwd: ${s.cwd ?? ""}`,
		"```",
		""
	);

	return fm.join("\n") + "\n" + body.join("\n");
}

export function renderClusterNote(
	c: StoredCluster,
	sessions: StoredSession[],
	commonPattern: string
): string {
	const tags = ["agent-cluster"];
	if (c.skillStatus === "candidate") tags.push("skill-candidate");

	const fm: string[] = [
		"---",
		"type: agent-cluster",
		`cluster_id: ${yamlStr(c.clusterId)}`,
		`sessions: ${sessions.length}`,
		`skill_status: ${c.skillStatus}`,
		`tags: [${tags.join(", ")}]`,
		"generated: true",
		"---",
	];

	const body: string[] = ["", `# ${c.name}`, "", "## 所属セッション"];
	const sorted = [...sessions].sort((a, b) =>
		(a.startedAt ?? "").localeCompare(b.startedAt ?? "")
	);
	for (const s of sorted) body.push(`- [[${noteBasename(s.notePath)}]]`);
	body.push("");

	body.push("## 共通パターン(Skill候補の素材)");
	body.push(commonPattern.length > 0 ? commonPattern : "(素材なし)");
	body.push("");

	body.push("```skill-promote", `cluster_id: ${c.clusterId}`, "```", "");

	return fm.join("\n") + "\n" + body.join("\n");
}

/** 頻度集計ベースの共通パターン列挙(Ollama 無効時のフォールバック、設計書 §5.2/§8) */
export function summarizeCommonPatterns(sessions: StoredSession[]): string {
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
		lines.push("共通して実行されたコマンド:");
		for (const [c, n] of commonCmds) lines.push(`- \`${c.replace(/`/g, "'")}\` (${n}/${sessions.length})`);
	}

	const repos = new Map<string, number>();
	for (const s of sessions) {
		if (s.repo) repos.set(s.repo, (repos.get(s.repo) ?? 0) + 1);
	}
	if (repos.size > 0) {
		lines.push(
			"対象リポジトリ: " +
				[...repos.entries()]
					.sort((a, b) => b[1] - a[1])
					.map(([r, n]) => `${r} (${n})`)
					.join(", ")
		);
	}
	return lines.join("\n");
}

/** クラスタブリーフ(Codex skill-creator に渡す素材、設計書 §8) */
export function renderBrief(
	c: StoredCluster,
	sessions: StoredSession[],
	commonPattern: string
): string {
	const sorted = [...sessions].sort((a, b) =>
		(a.startedAt ?? "").localeCompare(b.startedAt ?? "")
	);

	const lines: string[] = [
		"---",
		"type: agent-skill-brief",
		`cluster_id: ${yamlStr(c.clusterId)}`,
		`sessions: ${sessions.length}`,
		"generated: true",
		"---",
		"",
		`# Skill化ブリーフ: ${c.name}`,
		"",
		"このファイルは Agent Constellation が類似セッション群から自動生成した、",
		"skill-creator 用の素材です。以下の繰り返しパターンを skill にまとめてください。",
		"",
		"## 共通パターン",
		commonPattern.length > 0 ? commonPattern : "(自動抽出なし。各セッションのプロンプトから判断してください)",
		"",
		"## 各セッションのプロンプト",
	];

	for (const s of sorted) {
		lines.push("", `### ${dateStrOf(s.startedAt)} ${s.title}`);
		if (s.repo || s.cwd) lines.push(`- 対象: ${s.repo ?? s.cwd}`);
		for (const [i, msg] of splitPrompts(s).entries()) {
			lines.push("", `プロンプト${i + 1}:`, "", "```", msg, "```");
		}
		if (s.commands.length > 0) {
			lines.push("", "実行コマンド:");
			for (const cmd of s.commands.slice(0, 15)) lines.push(`- \`${cmd.replace(/`/g, "'")}\``);
		}
		if (s.files.length > 0) {
			lines.push("", "変更ファイル: " + s.files.slice(0, 15).join(", "));
		}
	}

	lines.push(
		"",
		"## セッション間で異なっていた部分(パラメータ候補)",
		variableParts(sorted),
		""
	);
	return lines.join("\n");
}

function splitPrompts(s: StoredSession): string[] {
	// text はユーザー発話を "\n\n---\n\n" 区切りで連結して保存している
	return s.text.split("\n\n---\n\n").filter((t) => t.trim().length > 0).slice(0, 5);
}

function variableParts(sessions: StoredSession[]): string {
	const lines: string[] = [];
	const repos = new Set(sessions.map((s) => s.repo ?? s.cwd ?? "(不明)"));
	if (repos.size > 1) {
		lines.push(`- 対象リポジトリ/ディレクトリが異なる: ${[...repos].join(", ")}`);
	}
	const uncommon = new Map<string, number>();
	const half = Math.max(2, Math.ceil(sessions.length / 2));
	const freq = new Map<string, number>();
	for (const s of sessions) {
		for (const c of new Set(s.commands)) freq.set(c, (freq.get(c) ?? 0) + 1);
	}
	for (const [c, n] of freq) if (n < half) uncommon.set(c, n);
	if (uncommon.size > 0) {
		lines.push("- 一部のセッションのみで実行されたコマンド(可変部分の候補):");
		for (const [c] of [...uncommon.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
			lines.push(`  - \`${c.replace(/`/g, "'")}\``);
		}
	}
	return lines.length > 0 ? lines.join("\n") : "(顕著な差分は検出されませんでした)";
}
