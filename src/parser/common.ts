/** 各エージェントのセッションパーサが共有するヘルパー・上限値 */

export const MAX_COMMANDS = 50;
export const MAX_FILES = 50;
export const MAX_COMMAND_LEN = 200;
export const MAX_TEXT_PER_MESSAGE = 4000;

export function asString(v: unknown): string | null {
	return typeof v === "string" && v.length > 0 ? v : null;
}

/** command が ["bash","-lc","..."] 形式なら中身だけを取り出して1行にする */
export function normalizeCommand(command: unknown): string | null {
	let parts: string[];
	if (typeof command === "string") {
		parts = [command];
	} else if (Array.isArray(command)) {
		parts = command.filter((c): c is string => typeof c === "string");
	} else {
		return null;
	}
	if (parts.length === 0) return null;
	if (
		parts.length >= 3 &&
		["bash", "zsh", "sh"].includes(parts[0]) &&
		["-lc", "-c", "-lic"].includes(parts[1])
	) {
		parts = [parts.slice(2).join(" ")];
	}
	const joined = parts.join(" ").replace(/\s+/g, " ").trim();
	if (joined.length === 0) return null;
	return joined.length > MAX_COMMAND_LEN
		? joined.slice(0, MAX_COMMAND_LEN) + " …"
		: joined;
}

/** cwd 配下の絶対パスを相対パスに直す */
export function relativizeFiles(files: string[], cwd: string | null): string[] {
	if (!cwd) return files;
	const prefix = cwd.endsWith("/") ? cwd : cwd + "/";
	return files.map((f) => (f.startsWith(prefix) ? f.slice(prefix.length) : f));
}

/** 重複と上限を管理しながら値を集めるバケット */
export class CappedSet {
	private seen = new Set<string>();
	readonly values: string[] = [];

	constructor(private cap: number) {}

	push(value: string | null | undefined): void {
		const v = value?.trim();
		if (!v || this.seen.has(v) || this.values.length >= this.cap) return;
		this.seen.add(v);
		this.values.push(v);
	}
}
