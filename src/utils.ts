export function expandHome(p: string, home: string): string {
	if (p === "~") return home;
	if (p.startsWith("~/")) return home + p.slice(1);
	return p;
}

/** シェルコマンドに埋め込むパスをシングルクォートで包む */
export function shellQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function fillShellTemplate(template: string, values: Record<string, string>): string {
	let command = template;
	for (const [name, value] of Object.entries(values)) {
		command = command.split(`{${name}}`).join(shellQuote(value));
	}
	return command;
}

/** 依存ゼロの軽量ハッシュ(embedding キャッシュのキー用) */
export function hashText(text: string): string {
	let h1 = 5381;
	let h2 = 52711;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		h1 = (h1 * 33) ^ c;
		h2 = (h2 * 31) ^ c;
	}
	return (h1 >>> 0).toString(36) + "-" + (h2 >>> 0).toString(36);
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 長い処理を UI をブロックせずチャンク実行するためのヘルパ */
export async function yieldEvery(counter: { n: number }, every = 20): Promise<void> {
	counter.n++;
	if (counter.n % every === 0) await sleep(0);
}
