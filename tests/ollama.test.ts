import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaClient } from "../src/ollama";

describe("OllamaClient", () => {
	afterEach(() => vi.restoreAllMocks());

	it("モデル一覧をキャッシュし、存在しないモデルへの生成を事前に避けられる", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ models: [{ name: "bge-m3:latest" }, { model: "gemma:2b" }] }),
		} as Response);
		const client = new OllamaClient("http://localhost:11434");
		expect(await client.hasModel("bge-m3")).toBe(true);
		expect(await client.hasModel("missing")).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("出力言語に応じたクラスタ命名プロンプトを使う", async () => {
		const client = new OllamaClient("http://localhost:11434");
		const generate = vi.spyOn(client, "generate").mockResolvedValue("Testing workflow");
		expect(await client.nameCluster("model", ["Run tests"], "en")).toBe("Testing workflow");
		expect(generate.mock.calls[0][1]).toContain("short English name");
	});
});
