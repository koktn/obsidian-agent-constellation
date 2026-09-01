import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile as MockTFile } from "./mocks/obsidian";

import { ConstellationEngine } from "../src/engine";
import type { ACSettings } from "../src/settings";
import type { EmbeddingCache, LedgerData, ParsedSession } from "../src/types";
import type { SessionSource } from "../src/sources/SessionSource";

describe("ConstellationEngine reconciliation", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("元ログが削除されたとき台帳・embedding・生成ノートを整理する", async () => {
		const files = new Map<string, { file: MockTFile; content: string }>();
		const folders = new Set<string>();
		const vault = {
			getAbstractFileByPath: (path: string) =>
				files.get(path)?.file ?? (folders.has(path) ? { path } : null),
			createFolder: async (path: string) => {
				folders.add(path);
			},
			create: async (path: string, content: string) => {
				const file = new MockTFile(path);
				files.set(path, { file, content });
				return file;
			},
			read: async (file: MockTFile) => files.get(file.path)?.content ?? "",
			modify: async (file: MockTFile, content: string) => {
				files.set(file.path, { file, content });
			},
			getMarkdownFiles: () => [...files.values()].map((entry) => entry.file),
		};
		const app = {
			vault,
			fileManager: {
				trashFile: async (file: MockTFile) => {
					files.delete(file.path);
				},
				renameFile: async (file: MockTFile, path: string) => {
					const entry = files.get(file.path)!;
					files.delete(file.path);
					file.path = path;
					files.set(path, entry);
				},
			},
		};
		const ledger: {
			data: LedgerData;
			embeddings: EmbeddingCache;
			save: ReturnType<typeof vi.fn>;
			saveEmbeddings: ReturnType<typeof vi.fn>;
		} = {
			data: {
				version: 2,
				hostname: "host",
				sessions: {},
				clusters: {},
				skipped: {},
				edges: [],
				edgeSignature: "",
			},
			embeddings: { version: 2, model: "", entries: {} },
			save: vi.fn(async () => undefined),
			saveEmbeddings: vi.fn(async () => undefined),
		};
		const parsed: ParsedSession = {
			sessionId: "abc",
			source: "codex",
			startedAt: "2026-09-01T00:00:00Z",
			endedAt: "2026-09-01T00:01:00Z",
			cwd: null,
			title: null,
			firstUserPrompt: "Fix the test",
			userMessages: ["Fix the test"],
			lastAssistantMessage: "Done",
			commands: ["npm test"],
			files: ["test.ts"],
			turns: 1,
		};
		let present = true;
		const source: SessionSource = {
			id: "codex",
			rootAvailable: () => true,
			listSessionFiles: async () =>
				present ? [{ filePath: "/tmp/abc.jsonl", mtime: 1, size: 1 }] : [],
			parseSessionFile: async () => parsed,
			buildResumeCommand: () => "",
		};
		const settings: ACSettings = {
			noteFolder: "_Constellation",
			codexSessionsDir: "/tmp/codex",
			claudeSessionsDir: "/tmp/claude",
			autoScanIntervalMin: 0,
			watchEnabled: false,
			similarityLevel: "l2",
			ollamaEndpoint: "http://localhost:11434",
			ollamaEmbedModel: "bge-m3",
			ollamaSummariesEnabled: false,
			ollamaChatModel: "",
			linkThreshold: 0.35,
			maxLinksPerNote: 5,
			maxClusterSize: 40,
			skillCandidateThreshold: 5,
			skillCandidateLookbackDays: 30,
			outputLanguage: "en",
			terminal: "clipboard",
			skillCommandTemplate: "",
			importHostname: "",
			setupShown: true,
		};
		const engine = new ConstellationEngine(
			app as never,
			() => settings,
			ledger as never,
			() => "/tmp/codex",
			() => "/tmp/claude",
			async () => undefined,
		);
		engine.sources = [source];

		await engine.scan({ silent: true });
		expect(Object.keys(ledger.data.sessions)).toEqual(["codex:abc"]);
		expect([...files.keys()].some((path) => path.endsWith("Fix the test.md"))).toBe(true);
		const canonical = [...files.values()].find((entry) =>
			entry.file.path.endsWith("Fix the test.md"),
		)!;
		const duplicate = new MockTFile("Old/same-session.md");
		files.set(duplicate.path, { file: duplicate, content: canonical.content });
		await engine.auditGeneratedNotes();
		expect(files.has(duplicate.path)).toBe(false);

		ledger.embeddings.entries["codex:abc"] = { hash: "h", vector: [1] };
		const clusterFile = new MockTFile("_Constellation/clusters/cluster - stale.md");
		files.set(clusterFile.path, {
			file: clusterFile,
			content: "---\ntype: agent-cluster\ngenerated: true\n---\n",
		});
		ledger.data.clusters.stale = {
			clusterId: "stale",
			name: "stale",
			members: ["codex:abc"],
			skillStatus: "none",
			notePath: clusterFile.path,
		};
		present = false;
		await engine.scan({ silent: true });
		expect(Object.keys(ledger.data.sessions)).toHaveLength(0);
		expect(ledger.embeddings.entries["codex:abc"]).toBeUndefined();
		expect(Object.keys(ledger.data.clusters)).toHaveLength(0);
		expect(files.size).toBe(0);
	});
});
