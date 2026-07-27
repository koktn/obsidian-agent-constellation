# Agent Constellation

Codex CLI の実行履歴(セッション)を Obsidian のノートとして取り込み、標準 Graph View 上で「星座」のように俯瞰・探索できるようにする Obsidian プラグイン。

類似セッションのクラスタを検出し、次の 2 つへの導線を提供する:

1. 過去セッションの発見と **resume**(ノート上のボタンからターミナルを起動)
2. 繰り返しパターンの **Skill 化**(クラスタブリーフを生成し Codex CLI の skill-creator へ受け渡し)

- プラグインID: `agent-constellation`
- 対象環境: macOS / Obsidian デスクトップ版のみ(`isDesktopOnly: true`、Node API 使用)
- ローカル完結(外部 API 不使用。Ollama はローカルのためオプションで利用)
- テレメトリなし

## 主な機能

- `~/.codex/sessions/**/rollout-*.jsonl` をスキャンし、`_Constellation/sessions/` にセッションノートを生成(差分取り込み・進捗表示付き)
- 類似度計算は段階式: L1(同一 repo/cwd + 変更ファイルの Jaccard)+ L2(文字 bi-gram TF-IDF、依存ゼロ)、設定で L3(Ollama embedding)に切替可能
- 類似セッションを貪欲クラスタリングし、`_Constellation/clusters/` にハブノートを生成。Graph View 上で「大きいノード = 繰り返しているタスク = Skill 候補」が視覚的に一致する
- クラスタの所属数が閾値(既定 5)に達すると `#skill-candidate` タグを付与(Graph View のグループ色分けで光らせられる)
- セッションノートの「▶ このセッションを再開」ボタンで Terminal.app / Ghostty を起動(またはコマンドをコピー)
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

## ドキュメント

- [設計書(v0.1)](docs/design.md)

## ステータス

v0.1。設計書のマイルストーン M1〜M6(パーサ+Importer / リンク+ハブノート / Resume / 差分取り込み+監視 / Ollama 統合 / Skill 化フロー)を実装済み。

実データ(`~/.codex/sessions` の rollout)でパース〜類似度〜クラスタリング〜ノート生成のパイプライン、Ghostty のコマンド付き起動(`open -na Ghostty --args -e`)、Ollama(gemma4)によるクラスタ命名を検証済み。Obsidian アプリ内 UI(ボタン・設定タブ・ファイル監視)の実機検証は今後行う。
