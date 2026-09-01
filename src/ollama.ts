/**
 * Ollama クライアント(オプション依存、設計書 §6)。
 * localhost のみを想定。未導入・停止中でもプラグイン本体は L1+L2 で動作する。
 */

const REQUEST_TIMEOUT_MS = 60_000;

async function post(endpoint: string, path: string, body: unknown): Promise<unknown> {
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
	private tagCache: { at: number; names: string[] } | null = null;

	constructor(private endpoint: string) {}

	async available(): Promise<boolean> {
		return (await this.modelNames()) !== null;
	}

	async hasModel(model: string): Promise<boolean> {
		if (!model) return false;
		const names = await this.modelNames();
		if (!names) return false;
		return names.some((name) => name === model || name.split(":")[0] === model);
	}

	private async modelNames(): Promise<string[] | null> {
		if (this.tagCache && Date.now() - this.tagCache.at < 30_000) {
			return this.tagCache.names;
		}
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 3_000);
		try {
			const res = await fetch(this.endpoint.replace(/\/$/, "") + "/api/tags", {
				signal: controller.signal,
			});
			if (!res.ok) return null;
			const data = (await res.json()) as { models?: { name?: unknown; model?: unknown }[] };
			const names = (data.models ?? [])
				.flatMap((entry) => [entry.name, entry.model])
				.filter((name): name is string => typeof name === "string");
			this.tagCache = { at: Date.now(), names };
			return names;
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
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
	async nameCluster(
		model: string,
		prompts: string[],
		locale: "en" | "ja" = "ja",
	): Promise<string | null> {
		const sample = prompts.slice(0, 8).map((p, i) => `${i + 1}. ${p.slice(0, 200)}`);
		const prompt =
			(locale === "ja"
				? "以下は同じ種類の作業を繰り返し行った複数のセッションのプロンプトです。\nこれらに共通する作業内容を表す短い日本語の名前を1つだけ、名前のみ出力してください。\n条件: 15文字以内、記号・引用符・説明文なし。\n\n"
				: "These prompts come from repeated sessions of the same kind of work. Return only one short English name that describes their shared task. Use at most five words and no quotes or explanation.\n\n") +
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
			const cleaned = name
				.replace(/["'「」『』。、]/g, "")
				.trim()
				.slice(0, 20);
			return cleaned.length > 0 ? cleaned : null;
		} catch {
			return null;
		}
	}

	/** クラスタの共通パターン説明を生成する(ハブノート・ブリーフ用) */
	async describeCluster(
		model: string,
		prompts: string[],
		commands: string[],
		locale: "en" | "ja" = "ja",
	): Promise<string | null> {
		const prompt =
			(locale === "ja"
				? "以下は同じ種類の作業を繰り返した複数セッションのプロンプトと実行コマンドです。\n共通する作業パターンと、セッションごとに変わるパラメータ候補を、日本語の箇条書きで5行以内にまとめてください。\n\nプロンプト:\n"
				: "These prompts and commands come from repeated sessions of the same kind of work. Summarize the common workflow and variable parameters in at most five English bullet points.\n\nPrompts:\n") +
			prompts
				.slice(0, 8)
				.map((p) => `- ${p.slice(0, 200)}`)
				.join("\n") +
			(locale === "ja" ? "\n\nコマンド:\n" : "\n\nCommands:\n") +
			commands
				.slice(0, 20)
				.map((c) => `- ${c}`)
				.join("\n");
		try {
			const res = await this.generate(model, prompt);
			const cleaned = res.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
			return cleaned.length > 0 ? cleaned : null;
		} catch {
			return null;
		}
	}
}
