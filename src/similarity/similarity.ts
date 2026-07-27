/**
 * 類似度の合成(設計書 §6)。
 * L1: メタデータ(同一 repo/cwd + 変更ファイルの Jaccard 係数)
 * L2/L3: 意味的類似(TF-IDF または embedding の cosine)
 * 合成スコア = w1·L1 + w2·(L2 または L3)
 */

export interface SessionFeature {
	id?: string;
	repo: string | null;
	cwd: string | null;
	files: string[];
}

export function jaccard(a: string[], b: string[]): number {
	if (a.length === 0 || b.length === 0) return 0;
	const sa = new Set(a);
	const sb = new Set(b);
	let inter = 0;
	for (const x of sa) if (sb.has(x)) inter++;
	const union = sa.size + sb.size - inter;
	return union === 0 ? 0 : inter / union;
}

export function l1Score(a: SessionFeature, b: SessionFeature): number {
	let ctx = 0;
	if (a.repo && b.repo) {
		ctx = a.repo === b.repo ? 1 : 0;
	} else if (a.cwd && b.cwd) {
		ctx = a.cwd === b.cwd ? 1 : 0;
	}
	return 0.5 * ctx + 0.5 * jaccard(a.files, b.files);
}

export const DEFAULT_W1 = 0.4;
export const DEFAULT_W2 = 0.6;

export function combineScore(
	l1: number,
	semantic: number,
	w1 = DEFAULT_W1,
	w2 = DEFAULT_W2
): number {
	return w1 * l1 + w2 * semantic;
}

export function cosine(a: number[], b: number[]): number {
	const len = Math.min(a.length, b.length);
	if (len === 0) return 0;
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < len; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	if (na === 0 || nb === 0) return 0;
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
