/**
 * 文字 bi-gram TF-IDF + cosine(L2 類似度、設計書 §6)。
 * 日本語は分かち書き不要の文字 n-gram と相性が良く、依存ゼロの純TSで実装する。
 */

export function charBigrams(text: string): string[] {
	const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
	if (norm.length === 0) return [];
	if (norm.length <= 2) return [norm];
	const grams: string[] = [];
	for (let i = 0; i < norm.length - 1; i++) {
		grams.push(norm.slice(i, i + 2));
	}
	return grams;
}

function termCounts(text: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const g of charBigrams(text)) {
		counts.set(g, (counts.get(g) ?? 0) + 1);
	}
	return counts;
}

export class TfidfModel {
	private vectors = new Map<string, Map<string, number>>();
	private norms = new Map<string, number>();

	constructor(docs: Map<string, string>) {
		const df = new Map<string, number>();
		const tfs = new Map<string, Map<string, number>>();
		for (const [id, text] of docs) {
			const counts = termCounts(text);
			tfs.set(id, counts);
			for (const term of counts.keys()) {
				df.set(term, (df.get(term) ?? 0) + 1);
			}
		}
		const n = docs.size;
		for (const [id, counts] of tfs) {
			const vec = new Map<string, number>();
			let sq = 0;
			for (const [term, tf] of counts) {
				const idf = Math.log((n + 1) / ((df.get(term) ?? 0) + 1)) + 1;
				const w = tf * idf;
				vec.set(term, w);
				sq += w * w;
			}
			this.vectors.set(id, vec);
			this.norms.set(id, Math.sqrt(sq));
		}
	}

	similarity(a: string, b: string): number {
		const va = this.vectors.get(a);
		const vb = this.vectors.get(b);
		if (!va || !vb) return 0;
		const na = this.norms.get(a) ?? 0;
		const nb = this.norms.get(b) ?? 0;
		if (na === 0 || nb === 0) return 0;
		const [small, large] = va.size <= vb.size ? [va, vb] : [vb, va];
		let dot = 0;
		for (const [term, w] of small) {
			const w2 = large.get(term);
			if (w2 !== undefined) dot += w * w2;
		}
		return dot / (na * nb);
	}
}

const TOKEN_RE =
	/[A-Za-z][A-Za-z0-9_.-]{2,}|[゠-ヺー]{2,}|[一-鿿]{2,}/g;

const STOPWORDS = new Set([
	"the", "and", "for", "with", "this", "that", "して", "する", "ください",
	"下さい", "お願い", "please", "use", "using", "into", "from", "you",
]);

/**
 * クラスタ命名のフォールバック用キーワード抽出(設計書 §6)。
 * 出現ドキュメント数 → 総出現数の順で上位を返す。
 */
export function extractKeywords(texts: string[], n = 3): string[] {
	const docFreq = new Map<string, number>();
	const totalFreq = new Map<string, number>();
	for (const text of texts) {
		const seen = new Set<string>();
		TOKEN_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = TOKEN_RE.exec(text)) !== null) {
			const token = m[0].toLowerCase();
			if (STOPWORDS.has(token) || token.length > 24) continue;
			totalFreq.set(token, (totalFreq.get(token) ?? 0) + 1);
			if (!seen.has(token)) {
				seen.add(token);
				docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
			}
		}
	}
	return [...docFreq.keys()]
		.sort((a, b) => {
			const d = (docFreq.get(b) ?? 0) - (docFreq.get(a) ?? 0);
			if (d !== 0) return d;
			return (totalFreq.get(b) ?? 0) - (totalFreq.get(a) ?? 0);
		})
		.slice(0, n);
}
