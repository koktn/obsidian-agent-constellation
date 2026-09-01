import { describe, expect, it } from "vitest";
import { Ledger } from "../src/ledger";

describe("Ledger migration", () => {
	it("v1のsessionIdキー・cluster member・embeddingを複合キーへ移行する", async () => {
		const files = new Map<string, string>();
		files.set(
			".obsidian/plugins/agent-constellation/data/index-host.json",
			JSON.stringify({
				version: 1,
				hostname: "host",
				sessions: {
					abc: {
						sessionId: "abc",
						source: "claude",
						filePath: "/tmp/abc.jsonl",
						mtime: 1,
						size: 1,
						startedAt: null,
						endedAt: null,
						cwd: null,
						repo: null,
						title: "old",
						prompt: "old",
						text: "old",
						commands: [],
						files: [],
						turns: 1,
						summary: "old",
						notePath: "sessions/old.md",
					},
				},
				clusters: {
					old: {
						clusterId: "old",
						name: "old",
						members: ["abc"],
						skillStatus: "none",
						notePath: "clusters/old.md",
					},
				},
				skipped: {},
				edges: [],
				edgeSignature: "",
			}),
		);
		files.set(
			".obsidian/plugins/agent-constellation/data/embeddings-host.json",
			JSON.stringify({
				version: 1,
				model: "m",
				entries: { abc: { hash: "h", vector: [1] } },
			}),
		);
		const adapter = {
			exists: async (path: string) => files.has(path),
			read: async (path: string) => files.get(path) ?? "",
			mkdir: async () => undefined,
			write: async (path: string, value: string) => {
				files.set(path, value);
			},
		};
		const ledger = new Ledger(adapter as never, "host", ".obsidian");
		await ledger.load();

		expect(ledger.data.sessions["claude:abc"].key).toBe("claude:abc");
		expect(ledger.data.sessions["claude:abc"].lastAssistantMessage).toBeNull();
		expect(ledger.data.clusters.old.members).toEqual(["claude:abc"]);
		expect(ledger.embeddings.entries["claude:abc"].vector).toEqual([1]);
	});
});
