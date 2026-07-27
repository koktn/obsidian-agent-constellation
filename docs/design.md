# obsidian-agent-constellation 設計書

- リポジトリ名: `obsidian-agent-constellation`
- プラグインID: `agent-constellation`(Obsidianガイドラインに従い "obsidian" は含めない)
- 表示名: Agent Constellation
- バージョン: v0.1 設計ドラフト(2026-07-27)

---

## 1. 目的

Codex CLI の実行履歴(セッション)を Obsidian のノートとして取り込み、標準 Graph View 上で
「星座」のように俯瞰・探索できるようにする。類似セッションの塊(クラスタ)を検出し、

1. 過去セッションの発見と **resume**
2. 繰り返しパターンの **Skill 化**

への導線を提供する。

## 2. 要件

### 2.1 確定要件

| 項目 | 内容 |
|---|---|
| 言語 | UI・生成ノートともに日本語前提 |
| 実行環境 | macOS / Obsidian デスクトップ版のみ(Node API 使用のため `isDesktopOnly: true`) |
| ネットワーク | ローカル完結。外部 API 不使用(Ollama はローカルなので許容) |
| 対象ツール | まず Codex CLI(`~/.codex/sessions/**/rollout-*.jsonl`)。将来他エージェントへ拡張可能な設計 |
| 可視化 | Obsidian 標準 Graph View を使用(カスタム View は当面作らない) |
| データ配置 | 現在の Vault 内にプラグイン用ディレクトリを作成 |

### 2.2 ディレクトリの「隠し」要件について(重要な制約)

**Obsidian はドット始まりの隠しフォルダをインデックスしない**ため、
隠しフォルダ内の Markdown は Graph View に一切表示されない。
つまり「隠しディレクトリ」と「標準 Graph View 利用」は両立しない。

そこでデータを 2 層に分離する:

| 層 | 場所 | 可視性 | 内容 |
|---|---|---|---|
| ノート層 | `Constellation/`(Vault 直下、名前は設定で変更可) | 可視(必須) | セッションノート・クラスタハブノート。Graph View の表示対象 |
| 内部データ層 | `.obsidian/plugins/agent-constellation/data/` | 隠し | 取り込み済み管理台帳、embedding キャッシュ、類似度行列、設定 |

ノート層を可視にすることの副次的メリット:

- Graph View のフィルタ(`path:Constellation`)やグループ色分けの対象にできる
- Dataview 等の他プラグインから集計できる
- 障害時に人間が中身を確認できる(直接編集はしない運用でOK。プラグインは再生成時に
  frontmatter の `generated: true` を条件に上書きする)

邪魔さの軽減策: フォルダ名を `_Constellation` にして並び順の端に寄せる、
クイックスイッチャーや検索から除外したい場合は Obsidian 標準の
「Excluded files」設定を案内する(初回セットアップ時にプラグインから提案)。

## 3. 全体アーキテクチャ

```
┌─ Obsidian Plugin (TypeScript) ─────────────────────────┐
│                                                        │
│  SessionSource (interface)  ← 将来の他エージェント対応   │
│    └─ CodexSource: ~/.codex/sessions を fs で読む       │
│                                                        │
│  Importer   : JSONL → セッションノート (.md) 生成        │
│  Similarity : 類似度計算(段階式、§6)                   │
│  Linker     : ハブノート生成・[[リンク]] 挿入            │
│  Actions    : resume 起動 / Skill 化                    │
│  Settings   : 設定タブ(日本語UI)                       │
│                                                        │
└────────────────────────────────────────────────────────┘
        │ child_process                │ HTTP (任意)
        ▼                              ▼
  Terminal.app / iTerm2          Ollama (localhost:11434)
  (codex resume <id>)            embedding / クラスタ命名
```

- デスクトップ版プラグインは Node API がフル利用可能。`fs` で Vault 外
  (`~/.codex/`)を直接読み、`child_process` でターミナルを起動する。
- Ollama は**オプション依存**。未導入でもレベル1〜2の類似度計算で動作する(§6)。

## 4. データフロー

1. **スキャン**: 起動時+手動コマンド+(設定で有効化時)ファイル監視で
   `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` を列挙
2. **差分判定**: 内部データ層の台帳(session_id → mtime/サイズ)と比較し、新規・更新分のみ処理
3. **パース**: JSONL からメタデータと本文素材を抽出
   - session_id / 開始・終了時刻 / cwd / gitリポジトリ(cwd から検出)
   - 最初のユーザープロンプト(タイトル・要約素材)
   - ユーザー発話の全文(類似度計算の入力)
   - 実行コマンド・変更ファイルの一覧
4. **ノート生成**: `Constellation/sessions/` にセッションノートを生成
5. **類似度計算 → リンク・クラスタ更新**(§6)
6. **ハブノート更新**: クラスタごとのハブノートを生成・更新。閾値超えで Skill 候補化

処理は全て非同期・チャンク実行し、UI をブロックしない。

## 5. ノート設計

### 5.1 セッションノート

パス: `Constellation/sessions/2026-07-21 pre-commitフック設定.md`
(日付 + LLM または先頭プロンプトから生成した短い日本語タイトル)

````markdown
---
type: agent-session
source: codex
session_id: 0198xxxx-xxxx
started: 2026-07-21T10:32:00+09:00
cwd: /Users/me/dev/myapp
repo: myapp
turns: 14
files: [".husky/pre-commit", "package.json"]
cluster: git-hooks
tags: [agent-session, cluster/git-hooks]
generated: true
---

# pre-commitフック設定

## プロンプト
> huskyでpre-commitにlint-stagedを設定して

## 概要
(先頭プロンプト+末尾の結果から機械生成した2〜3行の要約)

## 実行コマンド
- `npm i -D husky lint-staged`
- ...

## 関連セッション
- [[2026-07-10 husky導入]]

## クラスタ
- [[cluster - git-hooks]]

```resume
session_id: 0198xxxx-xxxx
cwd: /Users/me/dev/myapp
```
````

- 末尾の `resume` コードブロックはプラグインがコードブロックプロセッサで
  **「▶ このセッションを再開」ボタン**として描画する(閲覧モード時)。
- `generated: true` のノートのみ再生成で上書き。ユーザーが手を入れたい場合は
  このフラグを外せば以後上書きされない、という逃げ道を用意。

### 5.2 クラスタハブノート

パス: `Constellation/clusters/cluster - git-hooks.md`

````markdown
---
type: agent-cluster
cluster_id: git-hooks
sessions: 6
skill_status: candidate   # none | candidate | promoted
generated: true
---

# git-hooks

## 所属セッション
- [[2026-07-01 pre-commit設定]]
- [[2026-07-10 husky導入]]
- ...

## 共通パターン(Skill候補の素材)
(Ollama 有効時に機械生成。無効時は頻出コマンド・キーワードの列挙)

```skill-promote
cluster_id: git-hooks
```
````

Graph View 上ではハブがリンク数に比例して大きく描画されるため、
**「大きいノード=繰り返しているタスク=Skill 候補」が視覚的に一致**する。

### 5.3 Graph View 設定の推奨(初回セットアップで案内)

- フィルタ: `path:Constellation`(専用表示にしたい場合)
- グループ例:
  - `tag:#agent-session` → 灰
  - `type:agent-cluster` 相当(`path:Constellation/clusters`)→ 青
  - `["skill_status": candidate]` は検索クエリで表現できないため、
    候補化時にタグ `#skill-candidate` も付与し `tag:#skill-candidate` → 黄 で光らせる

## 6. 類似度計算・クラスタリング(段階式)

「軽量高速が基本、Ollama で精度を上乗せ」という方針で 3 レベル構成にする。

| レベル | 手法 | 依存 | 用途 |
|---|---|---|---|
| L1 | メタデータ: 同一 repo/cwd、変更ファイルの Jaccard 係数 | なし | 常時有効。確実なリンク |
| L2 | 字句類似: プロンプト文の**文字 bi-gram TF-IDF + cosine** | なし(純TS実装) | 既定の意味的リンク。日本語は分かち書き不要の文字 n-gram が軽くて相性が良い |
| L3 | embedding: Ollama(既定 `bge-m3` などの多言語モデル)| Ollama | 設定でON。言い回しが違う同種タスクを拾う |

- 合成スコア = w1·L1 + w2·(L2 または L3)。閾値超えのペアに直接リンクを張る。
- **クラスタリングは類似度グラフ上の貪欲な凝集(または連結成分+サイズ上限)**で行う。
  数百〜千セッション規模なら純TSで数百msに収まる想定。HDBSCAN 等の重い手法は使わない。
- L3 有効化時は embedding を内部データ層にキャッシュし、新規セッション分のみ計算。
- クラスタ命名: Ollama 有効時は所属プロンプト群を小型ローカルLLMに渡して日本語の短い名前を
  生成。無効時は TF-IDF 上位キーワードを機械的に連結(例: `husky-precommit-lint`)。

## 7. Resume 機能

- セッションノートの「▶ 再開」ボタン、またはコマンドパレット
  「Agent Constellation: このセッションを再開」から実行。
- 実装: `child_process` + AppleScript でターミナル起動

```
tell application "Terminal"
  do script "cd <cwd> && codex resume <session_id>"
  activate
end tell
```

- 設定でターミナルを選択: **Terminal.app(既定)/ Ghostty / コマンドをクリップボードにコピーのみ**
  - Terminal.app: 上記 AppleScript 方式(確実)
  - Ghostty: AppleScript 対応が限定的なため `open -na Ghostty --args -e <shell command>`
    方式を第一候補として実装時に検証する(§13 残課題)。動かない環境向けに
    「Ghostty を開く+コマンドをクリップボードにコピー」のフォールバックを必ず用意
- cwd が消滅している場合は警告を出し、ホームディレクトリでの起動かコピーのみを提案。

## 8. Skill 化機能

**方針: Skill の作成自体は Codex CLI(skill-creator)が担う。本プラグインの責務は
「類似セッションを束ねた素材(クラスタブリーフ)を作り、Codex に渡す」ところまで。**

1. クラスタの所属セッション数が閾値(既定 5、設定可)に達すると
   `skill_status: candidate` + `#skill-candidate` タグを付与(Graph View で黄色に光る)
2. ハブノートの「Codex に渡して Skill 化」ボタンで**クラスタブリーフ**を生成:
   - パス: `Constellation/skills/brief - <クラスタ名>.md`
   - 内容: 所属セッションの各プロンプト全文 / 共通して実行されたコマンド列 /
     セッション間で異なっていた部分(パラメータ候補)/ 対象 repo・ファイル
   - Ollama 有効時は共通パターン・可変部分の抽出を LLM で補強、
     無効時は頻度集計ベースの機械的な列挙(どちらでも成立する)
3. 続けてターミナル(§7 と同じ機構)で Codex を起動し、ブリーフを渡す:

   ```
   cd <repo> && codex "skill-creator を使って、次のファイルにまとめた
   繰り返しパターンを skill 化して: <ブリーフの絶対パス>"
   ```

   起動コマンドはテンプレートとして設定で編集可能にする
   (skill-creator の呼び出し方の変化に追従できるように)
4. Skill 完成後、ハブノートの `skill_status` を `promoted` に更新するボタンを用意
   (自動検知はせず手動更新。シンプルさ優先)

## 9. 設定項目(設定タブ、日本語)

- ノートフォルダ名(既定: `_Constellation`)
- Codex セッションディレクトリ(既定: `~/.codex/sessions`)
- 自動スキャン間隔 / ファイル監視の有効化
- 類似度: L2/L3 の選択、Ollama エンドポイント・モデル名、リンク閾値
- クラスタ: Skill 候補化の閾値
- Resume: ターミナル種別(Terminal.app / Ghostty / コピーのみ)
- Skill 化: Codex 起動コマンドのテンプレート
- 取り込み担当マシンのロック(同期環境向け、§12 参照)

## 10. 技術スタック

- TypeScript + esbuild(Obsidian 公式 sample-plugin 構成に準拠)
- 追加ランタイム依存は極力ゼロ(TF-IDF・クラスタリングは自前実装)
- テスト: vitest(パーサ・類似度のユニットテスト。JSONL のフィクスチャを同梱)
- `manifest.json`: `isDesktopOnly: true`

## 11. マイルストーン

| M | 内容 | 完了条件 |
|---|---|---|
| M1 | パーサ+Importer | 手動コマンドで全セッションがノート化され Graph View に表示 |
| M2 | L1+L2 リンク+ハブノート | Graph View 上でクラスタの塊が見える |
| M3 | Resume | ボタンからターミナルが起動し再開できる |
| M4 | 差分取り込み+ファイル監視 | 新規セッションが自動で追加される |
| M5 | Ollama 統合(L3+命名) | 設定ONで精度・命名が向上する |
| M6 | Skill 化フロー | 候補検出→ドラフト→書き出しが一通り動く |

## 12. リスク・留意点

- **Codex の JSONL スキーマは非公式・変更されうる**: パーサはフォーマット
  バージョン差異に耐えるよう防御的に書き、未知イベントは無視する
- **セッション本文には機密が含まれうる**: ノートには全文を転記せず、
  プロンプト冒頭+要約+コマンド一覧に留める(設定で全文転記も選択可)
- **Vault 同期利用時**: ノートの同期自体は問題ないが、次の 2 点に対処する
  1. **二重取り込みの防止**: 複数マシンで本プラグインが同時に取り込みを行うと
     ノートの重複・競合が起きうる。設定「取り込み担当マシンのロック」で
     ホスト名を記録し、一致するマシンだけが取り込み・リンク更新を実行する
     (他マシンは閲覧+存在チェック付き resume のみ)
  2. **resume の可搬性**: セッション実体(~/.codex/sessions)は同期されないため、
     別マシンでは resume 不可。ボタン押下時に cwd とセッションファイルの
     存在チェックを行い、無い場合は日本語で案内する
  - 内部データ層(台帳・キャッシュ)は `.obsidian/plugins/` 配下にあるため、
    Obsidian Sync の既定ではプラグインデータは同期対象外だが、iCloud 等の
    フォルダ同期では巻き込まれる。台帳にホスト名を含めて他マシンの台帳と
    衝突しないファイル名(`index-<hostname>.json`)にする
- 大量セッション(数千件)時の初回取り込みは進捗表示付きのバッチ処理にする

## 13. 確定事項と残課題

### 確定事項(2026-07-27 ヒアリング反映)

1. **Skill 化**: 作成は Codex CLI + skill-creator が担当。プラグインは
   クラスタブリーフの生成と Codex への受け渡しまで(§8)
2. **Ollama**: 導入済み。ただし未導入環境でも L1+L2 で完全動作する設計を維持
3. **規模**: 数百セッション想定 → 純 TS の TF-IDF+貪欲クラスタリングで十分
4. **ターミナル**: Terminal.app を既定、Ghostty を選択肢として提供
5. **同期**: あり得る前提で設計(§12 の担当マシンロック+存在チェック)
6. **ノート本文**: 要約+コマンド一覧のみ(全文転記なし)。設定での切替も設けない
   ことでシンプルに保つ(必要になったら追加)
7. **公開**: まず個人利用。将来のコミュニティ公開を見据え、公式ガイドライン
   (ID 命名、`isDesktopOnly`、Node API 使用の明示、テレメトリなし)に準拠して開発

### 残課題(実装時に検証)

- ~~Ghostty のコマンド付き起動方法(`open -na Ghostty --args -e ...`)の動作確認。
  不可ならクリップボードフォールバックに自動切替~~
  → **検証済み(2026-07-28)**: `open -na Ghostty --args -e sh -lc <command>` で
  コマンド実行まで動作することを実機で確認。フォールバックも実装済み
- ~~Codex CLI の JSONL スキーマの実データ確認~~
  → **検証済み(2026-07-28)**: 実データで確認し、以下をパーサ・エンジンに反映
  - Codex は AGENTS.md の前置き(`# AGENTS.md instructions for ...`)も user
    メッセージとして記録する → 機械挿入テキストとして除外
  - ユーザー発話ゼロのセッション(environment_context のみ)が多数存在し、
    フォールバックタイトル同士が高類似となり偽クラスタ(Skill 候補の誤検出)を
    作る → 取り込み時にスキップし、台帳の `skipped` に記録して再処理を防ぐ
