# Agent Constellation

Codex CLI の実行履歴(セッション)を Obsidian のノートとして取り込み、標準 Graph View 上で「星座」のように俯瞰・探索できるようにする Obsidian プラグイン。

類似セッションのクラスタを検出し、次の 2 つへの導線を提供する:

1. 過去セッションの発見と **resume**
2. 繰り返しパターンの **Skill 化**(Codex CLI の skill-creator への受け渡し)

- プラグインID: `agent-constellation`
- 対象環境: macOS / Obsidian デスクトップ版のみ(`isDesktopOnly: true`)
- ローカル完結(外部 API 不使用。Ollama はローカルのためオプションで利用)

## ドキュメント

- [設計書(v0.1 ドラフト)](docs/design.md)

## ステータス

v0.1 設計ドラフト段階。実装はこれから(マイルストーンは設計書 §11 を参照)。
