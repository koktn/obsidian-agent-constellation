import { describe, expect, it } from "vitest";
import {
	combineScore,
	cosine,
	jaccard,
	l1Score,
} from "../src/similarity/similarity";

describe("jaccard", () => {
	it("共通要素の割合を返す", () => {
		expect(jaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
		expect(jaccard(["a"], ["a"])).toBe(1);
		expect(jaccard([], ["a"])).toBe(0);
	});
});

describe("l1Score", () => {
	it("同一 repo + ファイル一致で最大", () => {
		const a = { id: "a", repo: "myapp", cwd: "/x", files: ["package.json"] };
		const b = { id: "b", repo: "myapp", cwd: "/x", files: ["package.json"] };
		expect(l1Score(a, b)).toBe(1);
	});
	it("repo 不明時は cwd で比較する", () => {
		const a = { id: "a", repo: null, cwd: "/x", files: [] };
		const b = { id: "b", repo: null, cwd: "/x", files: [] };
		expect(l1Score(a, b)).toBe(0.5);
	});
	it("無関係なら 0", () => {
		const a = { id: "a", repo: "app1", cwd: "/x", files: ["a.ts"] };
		const b = { id: "b", repo: "app2", cwd: "/y", files: ["b.ts"] };
		expect(l1Score(a, b)).toBe(0);
	});
});

describe("combineScore", () => {
	it("既定の重みは w1=0.4, w2=0.6", () => {
		expect(combineScore(1, 0)).toBeCloseTo(0.4);
		expect(combineScore(0, 1)).toBeCloseTo(0.6);
		expect(combineScore(1, 1)).toBeCloseTo(1);
	});
});

describe("cosine", () => {
	it("同方向は 1、直交は 0", () => {
		expect(cosine([1, 0], [2, 0])).toBeCloseTo(1);
		expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
	});
	it("ゼロベクトルは 0", () => {
		expect(cosine([0, 0], [1, 1])).toBe(0);
	});
});
