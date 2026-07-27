/**
 * Ollama クライアント(オプション依存、設計書 §6)。
 * localhost のみを想定。未導入・停止中でもプラグイン本体は L1+L2 で動作する。
 */

const REQUEST_TIMEOUT_MS = 60_000;

async function post(
	endpoint: string,
	path: string,
	body: unknown
): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const res = await fetch(endpoint.replace(/\/$/, "") + path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		if (!res.ok) {
			throw new Error(`Ollama HTTP ${res.status}`);
		}
		return await res.json();
	} finally {
		clearTimeout(timer);
	}
}

export class OllamaClient {
	constructor(private endpoint: string) {}

	async available(): Promise<boolean> {
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 3_000);
			const res = await fetch(this.endpoint.replace(/\/$/, "") + "/api/tags", {
				signal: controller.signal,
			});
			clearTimeout(timer);
			return res.ok;
		} catch {
			return false;
		}
	}

	async embed(model: string, texts: string[]): Promise<number[][]> {
		const data = (await post(this.endpoint, "/api/embed", {
			model,
			input: texts,
		})) as { embeddings?: number[][] };
		if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
			throw new Error("Ollama embed: 不正な応答");
		}
		return data.embeddings;
	}

	async generate(model: string, prompt: string): Promise<string> {
		const data = (await post(this.endpoint, "/api/generate", {
			model,
			prompt,
			stream: false,
		})) as { response?: string };
		if (typeof data.response !== "string") {
			throw new Error("Ollama generate: 不正な応答");
		}
		return data.response;
	}

	/** 所属プロンプト群から短い日本語のクラスタ名を生成する */
	async nameCluster(model: string, prompts: string[]): Promise<string | null> {
		const sample = prompts.slice(0, 8).map((p, i) => `${i + 1}. ${p.slice(0, 200)}`);
		const prompt =
			"以下は同じ種類の作業を繰り返し行った複数のセッションのプロンプトです。\n" +
			"これらに共通する作業内容を表す短い日本語の名前を1つだけ、名前のみ出力してください。\n" +
			"条件: 15文字以内、記号・引用符・説明文なし。\n\n" +
			sample.join("\n");
		try {
			const res = await this.generate(model, prompt);
			const name = res
				.replace(/<think>[\s\S]*?<\/think>/g, "")
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length > 0)
				.pop();
			if (!name) return null;
			const cleaned = name.replace(/["'「」『』。、]/g, "").trim().slice(0, 20);
			return cleaned.length > 0 ? cleaned : null;
		} catch {
			return null;
		}
	}

	/** クラスタの共通パターン説明を生成する(ハブノート・ブリーフ用) */
	async describeCluster(model: string, prompts: string[], commands: string[]): Promise<string | null> {
		const prompt =
			"以下は同じ種類の作業を繰り返した複数セッションのプロンプトと実行コマンドです。\n" +
			"共通する作業パターンと、セッションごとに変わるパラメータ候補を、日本語の箇条書きで5行以内にまとめてください。\n\n" +
			"プロンプト:\n" +
			prompts.slice(0, 8).map((p) => `- ${p.slice(0, 200)}`).join("\n") +
			"\n\nコマンド:\n" +
			commands.slice(0, 20).map((c) => `- ${c}`).join("\n");
		try {
			const res = await this.generate(model, prompt);
			const cleaned = res.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
			return cleaned.length > 0 ? cleaned : null;
		} catch {
			return null;
		}
	}
}
