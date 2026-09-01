import type { Edge, SessionSourceId, StoredSession } from "./types";
import { hashText } from "./utils";

export function sessionStorageKey(source: SessionSourceId, sessionId: string): string {
	return `${source}:${sessionId}`;
}

export function sessionFingerprint(session: StoredSession): string {
	return hashText(
		JSON.stringify({
			source: session.source,
			startedAt: session.startedAt,
			cwd: session.cwd,
			text: session.text,
			commands: session.commands,
			files: session.files,
		}),
	);
}

/** 完全に同じログ内容を持つ別IDを重複候補として印付けする。 */
export function markDuplicateSessions(sessions: StoredSession[]): void {
	const representative = new Map<string, string>();
	for (const session of [...sessions].sort(
		(a, b) =>
			(a.startedAt ?? "").localeCompare(b.startedAt ?? "") || a.key.localeCompare(b.key),
	)) {
		delete session.duplicateOf;
		const fingerprint = sessionFingerprint(session);
		const first = representative.get(fingerprint);
		if (first) session.duplicateOf = first;
		else representative.set(fingerprint, session.key);
	}
}

export function candidateMemberKeys(
	members: StoredSession[],
	lookbackDays: number,
	now = Date.now(),
): string[] {
	const cutoff = lookbackDays > 0 ? now - lookbackDays * 86_400_000 : null;
	return members
		.filter((session) => {
			if (session.duplicateOf) return false;
			if (cutoff === null) return true;
			if (!session.startedAt) return false;
			const timestamp = Date.parse(session.startedAt);
			return Number.isFinite(timestamp) && timestamp >= cutoff;
		})
		.map((session) => session.key);
}

export function linkDensity(memberKeys: string[], edges: Edge[]): number {
	if (memberKeys.length < 2) return 0;
	const members = new Set(memberKeys);
	let linked = 0;
	for (const edge of edges) {
		if (members.has(edge.a) && members.has(edge.b)) linked++;
	}
	return linked / ((memberKeys.length * (memberKeys.length - 1)) / 2);
}
