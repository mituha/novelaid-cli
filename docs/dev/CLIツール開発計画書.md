# 小説執筆補助CLIツール開発計画書

本書は、**Pi Coding Agent SDK（`@earendil-works/pi-coding-agent`）** および **Pi TUI（`@earendil-works/pi-tui`）** を利用して、小説執筆補助用のCLIツール（`novelaid-cli`）を開発するための計画書です。
まずは「CLIとしての基本動作が確認できるプロトタイプツールの作成」を第1フェーズのゴールとして定めます。

---

## 1. 計画の目的とゴール

### 1.1 目的
- 自律型エージェントSDKである **Pi Coding Agent SDK** を活用し、小説の執筆・プロット作成・設定考証を対話形式で補助するCLIツールの実現性を検証する。
- CLIのUI描画、セッション管理、ストリーミング出力、ユーザー対話ループにPi SDKのエコシステム（TUI / Agent Session）を最大限活用する。

### 1.2 第1フェーズのゴール（プロトタイプ完成基準）
1. ターミナルから `novelaid` コマンドで対話型CLIが起動できること。
2. 小説執筆補助に特化したシステムプロンプトが適用され、AIエージェントと自然な対話ができること。
3. AIの応答がリアルタイムにストリーミング表示されること。
4. セッション履歴が適切に管理され、文脈を維持した対話ができること。
5. エラーハンドリングおよび安全な終了処理（セッション破棄・リソース解放）が行われること。

---

## 2. システムアーキテクチャ設計

### 2.1 採用技術・SDKコンポーネント

| コンポーネント | パッケージ名 / 技術 | 役割・活用内容 |
|---|---|---|
| **コアエンジン** | `@earendil-works/pi-coding-agent` (v1.3.0) | `createAgentSession` によるエージェントライフサイクル管理、イベント購読、モデルプロバイダー連携 |
| **モデル管理・ランタイム** | `ModelRuntime` / `ModelRegistry` (Pi SDK内蔵) | プロバイダー登録（LM Studio等の互換エンドポイント）、モデル一覧の動的取得・リフレッシュ、接続・認証ヘルスチェック（`checkAuth`）、実行時モデル変更（`session.setModel`） |
| **拡張・コマンド機構** | Pi SDK `ExtensionAPI` / `InlineExtension` | SDK標準のスラッシュコマンド登録（`registerCommand`）、ライフサイクルフック（`before_agent_start`等）。詳細は [Pi_Coding_Agent_SDK仕様調査書.md](./Pi_Coding_Agent_SDK仕様調査書.md) および [CLIコマンド管理仕様書.md](./CLIコマンド管理仕様書.md) 参照 |
| **セッション管理** | `SessionManager` (Pi SDK内蔵) | 会話履歴の永続化およびブランチ管理（インメモリ / ファイル永続化の選択） |
| **ターミナルUI** | `InteractiveMode` (@earendil-works/pi-tui) / `readline` | SDK標準フルTUI（Markdown描画、入力欄、ダイアログ）を主軸とし、軽量readline/printモードとのハイブリッド構成 |
| **リソース管理** | `DefaultResourceLoader` (Pi SDK内蔵) | `AGENTS.md`（小説執筆指針）の自動読み込み、スキル（`SKILL.md`）の自動探索とプロンプト展開 |
| **ランタイム基盤** | Node.js (v24+) / TypeScript (v5+) | 実行環境、型安全性確保、ESMモジュール構成 |

### 2.2 アーキテクチャ概要図

```mermaid
flowchart TD
    User([ユーザー / 作家]) <--> CLI[novelaid-cli エントリーポイント]
    CLI <--> TUI[UI / 入力ループ (@earendil-works/pi-tui)]
    CLI <--> Session[AgentSession (@earendil-works/pi-coding-agent)]
    CLI <--> MR[ModelRuntime / ModelRegistry (Pi SDK標準)]
    
    subgraph Pi Coding Agent SDK
        Session --> SM[SessionManager (履歴管理)]
        Session --> Engine[モデル推論 / イベントストリーム]
        Session --> Tools[執筆支援ツール群]
        MR --> Session
    end

    subgraph AI接続先（Pi SDKにより統一管理）
        MR <--> Local[ローカル: LM Studio<br/>http://localhost:1234/v1]
        MR <--> Cloud[クラウド: Google Gemini<br/>GEMINI_API_KEY]
    end

    subgraph 小説コンテキスト
        Engine --> Prompt[小説補助システムプロンプト]
        Engine --> Files[設定資料 / プロットファイル]
    end
```

### 2.3 優先AIモデル接続先設計（Pi SDK標準機能の完全活用）

本ツールでは、小説執筆支援というユースケースの特性（秘匿性・長文文脈）を鑑み、以下の2系統の接続先を最優先でサポートします。独自通信ロジックは作成せず、すべて **Pi Coding Agent SDK の標準API（`ModelRuntime` / `ModelRegistry`）** を介して管理します。

| 区分 | 接続先 | 接続方式 / 設定 | 小説執筆における主な役割とメリット |
|---|---|---|---|
| **ローカル（最優先）** | **LM Studio** | SDKプロバイダー登録 (`openai-completions`)<br/>Base URL: `http://localhost:1234/v1` | **完全プライベート＆日常の壁打ち**<br/>未公開の原稿やプロットが外部に漏れない安心感。トークン費用不要で日常的なアイデア出しやシーン描写の相談を素早く行える。 |
| **外部クラウド（最優先）** | **Google Gemini** | ネイティブプロバイダー (`google-gemini`)<br/>認証: `GEMINI_API_KEY` | **超長文コンテキスト＆全編推敲**<br/>100万〜200万トークンの巨大コンテキスト窓を活かし、長編小説の全章・詳細な世界観設定・キャラクター辞書を一括参照した論理破綻や伏線回収の検証が可能。 |

#### Pi SDKを活用したモデル制御の仕組み
1. **プロバイダー登録とモデル取得**:
   - `modelRuntime.registerProvider("lm-studio", { baseUrl: "http://localhost:1234/v1", api: "openai-completions", ... })`
   - `await modelRuntime.refresh()` を呼ぶことで、LM Studio側で利用可能なモデル一覧（例: `qwen/qwen3-8b` など）をSDKが自動検出してカタログ化。
2. **接続可能テスト（ヘルスチェック）**:
   - `modelRuntime.checkAuth("lm-studio")` を呼び出すことで、サーバー起動状態と疎通をSDK標準機能として検証。
3. **実行時モデル設定・変更**:
   - 初期化: `createAgentSession({ modelRuntime, model: selectedModel })`
   - 動的変更: `session.setModel(targetModel)`
   - 切り替え: `session.cycleModel()`

---

## 3. 開発ステップ（WBS / 実装ロードマップ）

プロトタイプの作成は、以下のステップで小さく確実に進めます。

```mermaid
flowchart LR
    S1[Step 1: 環境基盤構築 ✔] --> S2_1[Step 2-1: SDKモデル接続テスト ✔]
    S2_1 --> S2_2[Step 2-2: セッション・対話UI実装 ✔]
    S2_2 --> S3[Step 3: 小説補助コンテキスト組込]
    S3 --> S4[Step 4: 動作検証と調整]
```

### Step 1: プロジェクト基盤のセットアップ（✔ 完了）
- [x] `.gitignore` の整備（`node_modules/`, `dist/` の除外設定）
- [x] `package.json` の作成とESM（`"type": "module"`）設定。
- [x] TypeScript設定（`tsconfig.json`）の整備。
- [x] 依存関係のインストール:
  - `@earendil-works/pi-coding-agent` (v1.3.0)
  - `@earendil-works/pi-tui` (v1.3.0)
  - `typescript`, `@types/node`, `tsx`（開発時実行用）
- [x] ビルドスクリプトおよびCLI起動エントリーポイント（`src/cli.ts`, `bin/novelaid.js`）の作成と疎通確認。

### Step 2-1: Pi SDK `ModelRuntime` によるモデル接続・一覧取得と疎通テスト（✔ 完了）
- [x] `src/model-manager.ts` に Pi SDK の `ModelRuntime` および LM Studio 接続モジュールを実装。
- [x] LM Studio サーバーからの動的モデル取得と `modelRuntime.registerProvider("lm-studio", ...)` によるプロバイダー登録。
- [x] `runtime.getModels("lm-studio")` によるモデル一覧取得とターミナル整形表示。
- [x] `runtime.checkAuth("lm-studio")` および `--test` オプションによる1往復推論疎通テストの実装・検証完了。
- [x] 接続失敗時のトラブルシューティング案内の実装。

### Step 2-2: Pi SDKセッション連携とCLI対話UIの実装（✔ 完了）
- [x] `createAgentSession()` を用いたセッション初期化処理の実装（`src/chat-session.ts`）。
- [x] イベント購読（`session.subscribe`）によるリアルタイムストリーミング出力の実装。
- [x] 宣言的コマンド管理（`CommandRegistry`）による `/help`, `/model`, `/clear`, `/exit` の共通処理化。

### Step 2-3: Pi SDK標準フルTUI（InteractiveMode）へのエコ統合（✔ 完了）
- [x] Pi SDK 公式フルTUI（`InteractiveMode`）をメインエントリーポイントへ統合（自作TUIの車輪の再発明を回避）。
- [x] 公式 `InlineExtension`（`novelaidExtension`）による LM Studio モデルの動的プロバイダー登録と `/novelaid-info` コマンドの実装。
- [x] ハイブリッド起動（通常フルTUI、`--simple` 軽量readline、`--test` 疎通テスト）の実装・検証完了。

### Step 3: 小説執筆補助の専門コンテキスト組み込み（段階的実装）
※機能の全体像と詳細設計は [小説執筆補助機能計画書.md](./小説執筆補助機能計画書.md) および [作品フォルダー管理と二層スコープ仕様書.md](./作品フォルダー管理と二層スコープ仕様書.md) を参照。
小さな単位で1ステップずつ実装・動作確認・コミットを繰り返して進めます。

- **Step 3-1: 起動時プロジェクトフォルダー指定機能（✔ 完了）**:
  - [x] CLI起動引数からプロジェクトフォルダーパス（`-p / --project <path>` または位置引数 `<path>`）を受け取る処理の実装（`src/workspace/project-path.ts`）。
  - [x] 指定されたパスの存在確認・ディレクトリ判定・絶対パス解決およびエラーハンドリング。
  - [x] 解決されたプロジェクトフォルダーを作業ディレクトリ（`cwd`）として設定する処理の結合（`src/cli.ts`）。
  - [x] `--test` モードでのプロジェクトパス解決結果表示、相対パス指定（`-p ../novel-draft`）、存在しないパスのエラー処理の実装・検証完了。
- **Step 3-2: `/cd`（階層移動・現在位置表示・ルート上限ガード）の実装（✔ 完了）**:
  ※詳細は [ディレクトリ移動とフォルダー分類仕様書.md](./ディレクトリ移動とフォルダー分類仕様書.md) を参照。
  - [x] 現在作業フォルダーの管理、相対パス解決（`cd ..`, `cd <path>`）の実装（`src/workspace/navigator.ts`）。
  - [x] プロジェクトルートより上位への脱出を阻止するルート上限ガードの実装。
  - [x] `InlineExtension` への `/cd` および `/pwd` スラッシュコマンドの登録（`src/extensions/novelaid.ts`）。
  - [x] 単体テストによる動作検証（初期状態、サブフォルダー移動、`cd ..`、ルート上限ガード保護、無効パス処理）。
- **Step 3-2a: 作業フォルダー内の一覧表示コマンド（`/ls` / `/dir`）の実装（✔ 完了）**:
  - [x] `WorkspaceNavigator` に現在フォルダー配下の一覧取得メソッド（`listEntries()`）を追加（フォルダー優先、ファイル名昇順、拡張子表示）。
  - [x] `InlineExtension` への `/ls`（エイリアス `/dir`）スラッシュコマンド登録。
  - [x] 隠しファイル（`.git` 等）の除外・配慮処理。
  - [x] 単体テストおよび動作確認。
- **Step 3-2b: `/cd` 引数に対するフォルダー補完（`addAutocompleteProvider`）の実装（✔ 完了）**:
  - [x] Pi SDK 公式拡張 API `ctx.ui.addAutocompleteProvider` のハンドラー実装。
  - [x] 入力バッファが `/cd ` または `/cd <path>` の場合に、現在フォルダー直下のサブフォルダー一覧を補完候補として動的提示。
  - [x] Tabキーまたは確定時のパス補完適用（末尾スラッシュの付与等）。
  - [x] 動作確認と検証。
- **Step 3-3: DocumentType によるフォルダー・ファイル自動分類（✔ 完了）**:
  - [x] `NovelaidDocumentType` 型定義の作成（`src/workspace/types.ts`）。
  - [x] `.novelaidattributes` パーサー、ワイルドカード照合、キャッシュ機構の実装（`src/workspace/attributes.ts`）。
  - [x] `WorkspaceNavigator` への `getDocumentType`（ファイル種別判定）および `getDirectoryType`（フォルダー種別判定）の実装。
  - [x] YAML Front Matter メタデータ（`tags`）抽出パーサーの実装（`src/workspace/frontmatter.ts`）。
  - [x] 単体テストによる包括検証（全テストケース合格）。
- **Step 3-3b: 現在地およびDocumentTypeのAIコンテキスト動的注入（✔ 完了）**:
  - [x] Pi SDK の `before_agent_start` イベントフックによる動的プロンプト注入の実装。
  - [x] 現在の作業フォルダー、`NovelaidDocumentType`、役割ガイドラインを含む `<novelaid_workspace>` セクションの生成。
  - [x] `/pwd` コマンドへのフォルダー種別（DocumentType）表示統合。
  - [x] 単体テストによる包括検証（全テストケース合格）。
- **Step 3-4: `/cd` セマンティック移動（`/cd novel`, `/cd plot`, `/cd wiki`）の実装（✔ 完了）**:
  - [x] 移動関心事を `/cd <キーワード> [サブパス]` に集約（`/novel` や `/plot` のトップレベル空間は将来の本文編集・プロット作成アクション用に温存）。
  - [x] `WorkspaceNavigator` へのセマンティックフォルダー自動探索・解決メソッドの実装。
  - [x] `/cd` コマンドおよび Tab 補完プロバイダーへのセマンティック候補（`novel`, `plot`, `wiki`, `setting`, `root`）の統合。
  - [x] 単体テストによる包括検証（全テストケース合格）。
- **Step 3-5: AI対話による原稿ファイル書き換え実証（ルビ自動設定・校正推敲機能）（✔ 完了）**:
  ※詳細は [ルビ自動設定とファイル書き換え仕様書.md](./ルビ自動設定とファイル書き換え仕様書.md) を参照。
  - [x] **Step 3-5a: `novelaid-ruby` 構文の組み込みとルビ支援プロンプト/ツールの設計（✔ 完了）**:
    - 隣接リポジトリ `novelaid-ruby`（`../novelaid-ruby-ts`）のルビ記法規則（`|親文字《ルビ》`）を自立モジュール（`src/workspace/ruby.ts`）として実装。
    - 難読漢字・作中固有名詞・当て字の検出と、初出優先・二重ルビ防止ガイドラインを `getPersonaGuideline("novel")` に統合。
    - スラッシュコマンド `/ruby [ファイル名]` による原稿自動検出案内を実装。
    - 単体テスト（`scratch/test-ruby-module.mjs`）による包括検証。
  - [x] **Step 3-5b: テスト原稿を用いた対話・ファイル書き換え実証テスト（✔ 完了）**:
    - `test-novel/10_novels/第1話_旅立ちの朝.txt` などのテスト原稿を作成。
    - Pi SDK の標準ツール（`read`, `edit`）による差分プレビュー・承認・ファイル永続化・冪等性（再適用時の保護）を E2E テスト（`scratch/test-ruby-rewrite-e2e.mjs`）で完全実証。
  - [x] **Step 3-5c: 誤字脱字チェック・文体校正への横展開（✔ 完了）**:
    - `src/workspace/proofread.ts` に誤字・誤記・慣用句・重言・文末重複（「〜た」3連続）スキャナーを実装。
    - `WorkspaceNavigator` に原稿ファイル補完（`getFileSuggestions`）を追加し、`/ruby`, `/proofread`, `/check` コマンドでTab補完を可能に。
    - スラッシュコマンド `/proofread [ファイル名]`（エイリアス `/check`）および小説ペルソナへの校正・推敲指示を統合。
    - 単体・E2Eテスト（`scratch/test-proofread-module.mjs`）による包括検証完了。

### Step 4: 動作確認と検証
- 実際の対話シナリオによる動作検証（LM Studio および Gemini それぞれで確認）:
  - 「ファンタジー小説の序盤プロットの相談」
  - 「登場人物の動機と設定の整合性チェック」
- ストリーミング表示の遅延・文字化け、改行崩れがないかの確認。
- ローカル／外部クラウド間の切り替え体験の評価と、次フェーズ（専用ツール群・コマンド拡張）への課題抽出。

---

## 4. プロトタイプ後の展開（将来構想）

プロトタイプ（第1フェーズ）完了後は、以下の高度な小説執筆支援機能を順次拡張します。

1. **小説専用ツールの追加**:
   - 原稿ファイル（Markdown/テキスト）の文字数・ルビ・章立て分析ツール。
   - キャラクター一覧・世界観辞書からの自動設定抽出・不整合警告ツール。
2. **高度なTUI画面**:
   - `@earendil-works/pi-tui` のマルチペイン（左: 原稿プレビュー、右: AI対話）の導入。
3. **セッションブランチング**:
   - 「もしこの展開にしたら？」というプロット分岐をPi SDKのブランチ管理で並行検証する機能。
