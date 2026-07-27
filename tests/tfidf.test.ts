import { describe, expect, it } from "vitest";
import { TfidfModel, charBigrams, extractKeywords } from "../src/similarity/tfidf";

describe("charBigrams", () => {
	it("日本語を分かち書きなしで bi-gram 化する", () => {
		expect(charBigrams("設定して")).toEqual(["設定", "定し", "して"]);
	});
	it("空白を正規化する", () => {
		expect(charBigrams("a  b")).toEqual(["a ", " b"]);
	});
	it("空文字は空配列", () => {
		expect(charBigrams("  ")).toEqual([]);
	});
});

describe("TfidfModel", () => {
	const docs = new Map<string, string>([
		["a", "huskyでpre-commitにlint-stagedを設定して"],
		["b", "huskyのpre-commitフックにlint-stagedを設定"],
		["c", "GitHub Actions で deploy ワークフローを作って"],
	]);
	const model = new TfidfModel(docs);

	it("類似した文の方が高スコアになる", () => {
		const ab = model.similarity("a", "b");
		const ac = model.similarity("a", "c");
		expect(ab).toBeGreaterThan(ac);
		expect(ab).toBeGreaterThan(0.4);
		expect(ac).toBeLessThan(0.3);
	});

	it("同一文書は 1 に近い", () => {
		expect(model.similarity("a", "a")).toBeCloseTo(1, 5);
	});

	it("未知IDは 0", () => {
		expect(model.similarity("a", "zzz")).toBe(0);
	});
});

describe("extractKeywords", () => {
	it("複数文書に共通する語を優先する", () => {
		const kws = extractKeywords(
			[
				"huskyでpre-commitを設定して",
				"huskyのpre-commitフックを直して",
				"husky と lint-staged を入れて",
			],
			2
		);
		expect(kws[0]).toBe("husky");
	});
	it("キーワードが無ければ空配列", () => {
		expect(extractKeywords(["あ", "い"], 3)).toEqual([]);
	});
});
