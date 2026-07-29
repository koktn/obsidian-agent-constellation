# Agent Constellation

Import Codex CLI and Claude Code session history as notes, explore them like constellations in Obsidian's graph view, resume past sessions from a note, and turn repeated patterns into skills.

An Obsidian plugin for macOS (desktop only). Everything runs locally: no external network calls, no telemetry. UI (commands, settings, notices) is available in English and Japanese, following Obsidian's display language. Generated notes are currently Japanese. See the [Disclosures](#disclosures--開示事項) section for what this plugin accesses outside your vault.

---

Codex CLI / Claude Code の実行履歴(セッション)を Obsidian のノートとして取り込み、標準 Graph View 上で「星座」のように俯瞰・探索できるようにする Obsidian プラグイン。

類似セッションのクラスタを検出し、次の 2 つへの導線を提供する:

1. 過去セッションの発見と **resume**(ノート上のボタンからターミナルを起動)
2. 繰り返しパターンの **Skill 化**(クラスタブリーフを生成し Codex CLI の skill-creator へ受け渡し)

- プラグインID: `agent-constellation`
- 対象環境: macOS / Obsidian デスクトップ版のみ(`isDesktopOnly: true`、Node API 使用)
- ローカル完結(外部 API 不使用。Ollama はローカルのためオプションで利用)
- テレメトリなし
- UI(コマンド・設定・通知)は Obsidian の表示言語に従い英語/日本語に対応(生成ノート本文は日本語)

## Disclosures / 開示事項

This plugin uses Node APIs on desktop and accesses resources outside your vault. Nothing leaves your machine.

1. **Reads files outside the vault**: session history under `~/.codex/sessions` (Codex CLI) and `~/.claude/projects` (Claude Code), read-only, via Node `fs`. The directories are configurable. Session content may contain sensitive data; notes therefore include only the prompt excerpt, a short summary, and command/file lists — never the full transcript.
2. **Launches external processes**: only when you click a resume / skill button (or run the resume command), the plugin opens Terminal.app (via `osascript`) or Ghostty with a `codex resume` / `claude --resume` / skill-creator command, using Node `child_process`. You can instead choose "copy command to clipboard only" in settings.
3. **Network**: no external network access. Optionally connects to a local Ollama instance (`http://localhost:11434` by default, configurable) for embeddings and cluster naming. The plugin is fully functional without Ollama.
4. **No telemetry**: the plugin collects and sends nothing.

本プラグインはデスクトップ版の Node API を使用し、Vault の外にアクセスします。データがマシンの外に出ることはありません。

1. **Vault 外のファイル読み取り**: `~/.codex/sessions`(Codex CLI)と `~/.claude/projects`(Claude Code)のセッション履歴を Node `fs` で読み取り専用アクセスします(ディレクトリは設定で変更可)。セッションには機密が含まれうるため、ノートにはプロンプト冒頭・要約・コマンド/ファイル一覧のみを転記し、全文は転記しません。
2. **外部プロセスの起動**: resume / Skill 化のボタンを押したときのみ、`child_process` で Terminal.app(`osascript` 経由)または Ghostty を起動し、`codex resume` / `claude --resume` / skill-creator のコマンドを渡します。設定で「クリップボードにコピーのみ」も選べます。
3. **ネットワーク**: 外部への通信はありません。オプションでローカルの Ollama(既定 `http://localhost:11434`、変更可)に接続し、embedding とクラスタ命名に使います。Ollama なしでも全機能が動作します。
4. **テレメトリなし**: 収集・送信は一切行いません。

## 主な機能

- `~/.codex/sessions/**/rollout-*.jsonl`(Codex CLI)と `~/.claude/projects/*/<uuid>.jsonl`(Claude Code)をスキャンし、`_Constellation/sessions/` にセッションノートを生成(差分取り込み・進捗表示付き。ユーザー発話の無い空セッションは除外)
- 類似度計算は段階式: L1(同一 repo/cwd + 変更ファイルの Jaccard)+ L2(文字 bi-gram TF-IDF、依存ゼロ)、設定で L3(Ollama embedding)に切替可能
- 類似セッションを貪欲クラスタリングし、`_Constellation/clusters/` にハブノートを生成。Graph View 上で「大きいノード = 繰り返しているタスク = Skill 候補」が視覚的に一致する
- クラスタの所属数が閾値(既定 5)に達すると `#skill-candidate` タグを付与(Graph View のグループ色分けで光らせられる)
- セッションノートの「▶ このセッションを再開」ボタンで Terminal.app / Ghostty を起動(またはコマンドをコピー)。Codex は `codex resume`、Claude Code は `claude --resume` を発行
- ハブノートの「Codex に渡して Skill 化」ボタンでクラスタブリーフを生成し、skill-creator を起動
- 自動スキャン間隔・ファイル監視・取り込み担当マシンのロック(Vault 同期環境向け)に対応
- プラグインが上書きするのは frontmatter に `generated: true` を持つノートのみ。フラグを外せば手動編集を保護できる

## インストール(手動)

1. `npm install && npm run build`
2. Vault の `.obsidian/plugins/agent-constellation/` に `manifest.json` `main.js` `styles.css` をコピー
3. Obsidian の設定 → コミュニティプラグインで有効化
4. 初回起動時のセットアップガイドに従い、Graph View のフィルタ・グループを設定

## 開発

```bash
npm install
npm run dev    # esbuild watch
npm test       # vitest(パーサ・類似度・クラスタリング・ノート生成のユニットテスト)
npm run build  # 型チェック + 本番ビルド
```

## Graph View フィルタ例

グラフビュー右上の歯車 → 検索欄(フィルタ)に入力する。

- `_Constellation` だけの専用表示(星座ビュー):

  ```
  path:_Constellation
  ```

- クラスタハブは常に表示しつつ、セッションだけを日付で絞る。セッションノートのファイル名は `YYYY-MM-DD タイトル` で始まるため、`file:` で日付の前方一致ができる:

  ```
  path:_Constellation/clusters OR (path:_Constellation/sessions file:2026-07)
  ```

  `file:2026-07` の部分を `file:2026-07-28`(特定日)や `file:2026-`(年単位)に変えて調整できる。

## ドキュメント

- [設計書(v0.1)](docs/design.md)

## ステータス

v0.1。設計書のマイルストーン M1〜M6(パーサ+Importer / リンク+ハブノート / Resume / 差分取り込み+監視 / Ollama 統合 / Skill 化フロー)を実装済み。

実データ(`~/.codex/sessions` の rollout と `~/.claude/projects` のセッション)でパース〜類似度(L2/L3)〜クラスタリング〜ノート生成のパイプライン、Ghostty のコマンド付き起動、Ollama によるクラスタ命名、および Obsidian アプリ内 UI(ボタン・設定タブ・ファイル監視)の実機検証を完了済み。
