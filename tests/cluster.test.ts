import { describe, expect, it } from "vitest";
import { clusterize, matchClusterIds } from "../src/similarity/cluster";

describe("clusterize", () => {
	it("閾値以上のエッジで連結成分を作る", () => {
		const ids = ["a", "b", "c", "d", "e"];
		const edges = [
			{ a: "a", b: "b", score: 0.9 },
			{ a: "b", b: "c", score: 0.5 },
			{ a: "d", b: "e", score: 0.4 },
			{ a: "c", b: "d", score: 0.1 }, // 閾値未満
		];
		const clusters = clusterize(ids, edges, 0.35);
		expect(clusters).toHaveLength(2);
		expect(clusters[0]).toEqual(["a", "b", "c"]);
		expect(clusters[1]).toEqual(["d", "e"]);
	});

	it("単独ノードはクラスタにしない", () => {
		expect(clusterize(["a", "b"], [], 0.35)).toEqual([]);
	});

	it("サイズ上限を超える併合はしない", () => {
		const ids = ["a", "b", "c", "d"];
		const edges = [
			{ a: "a", b: "b", score: 0.9 },
			{ a: "c", b: "d", score: 0.8 },
			{ a: "b", b: "c", score: 0.7 }, // これを併合すると 4 > maxSize=2
		];
		const clusters = clusterize(ids, edges, 0.35, 2);
		expect(clusters).toHaveLength(2);
		expect(clusters.map((c) => c.length)).toEqual([2, 2]);
	});
});

describe("matchClusterIds", () => {
	it("50%以上重なる既存クラスタのIDを引き継ぐ", () => {
		const matched = matchClusterIds(
			[
				["a", "b", "c"],
				["x", "y"],
			],
			{ "git-hooks": ["a", "b"], deploy: ["p", "q"] }
		);
		expect(matched).toEqual(["git-hooks", null]);
	});

	it("同じ既存IDを二重に割り当てない", () => {
		const matched = matchClusterIds(
			[
				["a", "b"],
				["a2", "b2"],
			],
			{ only: ["a", "b", "a2", "b2"] }
		);
		expect(matched.filter((m) => m === "only")).toHaveLength(1);
	});
});
