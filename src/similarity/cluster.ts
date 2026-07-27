import type { Edge } from "../types";

/**
 * 類似度グラフ上の貪欲な凝集クラスタリング(設計書 §6)。
 * スコア降順にエッジを処理し、サイズ上限を超えない限り Union-Find で併合する。
 * 数百〜千セッション規模なら純TSで十分高速。
 */
export function clusterize(
	ids: string[],
	edges: Edge[],
	minScore: number,
	maxSize = 40
): string[][] {
	const parent = new Map<string, string>();
	const size = new Map<string, number>();
	for (const id of ids) {
		parent.set(id, id);
		size.set(id, 1);
	}
	const find = (x: string): string => {
		let root = x;
		while (parent.get(root) !== root) root = parent.get(root) as string;
		// 経路圧縮
		let cur = x;
		while (parent.get(cur) !== root) {
			const next = parent.get(cur) as string;
			parent.set(cur, root);
			cur = next;
		}
		return root;
	};

	const sorted = [...edges].sort((a, b) => b.score - a.score);
	for (const e of sorted) {
		if (e.score < minScore) break;
		if (!parent.has(e.a) || !parent.has(e.b)) continue;
		const ra = find(e.a);
		const rb = find(e.b);
		if (ra === rb) continue;
		const sa = size.get(ra) ?? 1;
		const sb = size.get(rb) ?? 1;
		if (sa + sb > maxSize) continue;
		parent.set(ra, rb);
		size.set(rb, sa + sb);
	}

	const groups = new Map<string, string[]>();
	for (const id of ids) {
		const root = find(id);
		const g = groups.get(root);
		if (g) g.push(id);
		else groups.set(root, [id]);
	}
	return [...groups.values()]
		.filter((g) => g.length >= 2)
		.map((g) => [...g].sort())
		.sort((a, b) => b.length - a.length);
}

/**
 * 再計算後のクラスタに既存のクラスタIDを引き継ぐ(名前の安定化)。
 * メンバーの重なりが最大かつ 50% 以上の既存クラスタを再利用する。
 */
export function matchClusterIds(
	newClusters: string[][],
	oldClusters: Record<string, string[]>
): (string | null)[] {
	const used = new Set<string>();
	return newClusters.map((members) => {
		const memberSet = new Set(members);
		let bestId: string | null = null;
		let bestOverlap = 0;
		for (const [oldId, oldMembers] of Object.entries(oldClusters)) {
			if (used.has(oldId)) continue;
			let overlap = 0;
			for (const m of oldMembers) if (memberSet.has(m)) overlap++;
			const ratio = overlap / Math.max(members.length, oldMembers.length);
			if (ratio >= 0.5 && overlap > bestOverlap) {
				bestOverlap = overlap;
				bestId = oldId;
			}
		}
		if (bestId) used.add(bestId);
		return bestId;
	});
}
