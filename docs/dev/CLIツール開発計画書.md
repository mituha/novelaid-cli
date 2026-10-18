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
| **セッション管理** | `SessionManager` (Pi SDK内蔵) | 会話履歴の永続化およびブランチ管理（インメモリ / ファイル永続化の選択） |
| **ターミナルUI** | `@earendil-works/pi-tui` (v1.3.0) / SDKイベント | ストリーミング表示（`text_delta`）、Markdown描画、プロンプト入力受付 |
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
- [x] イベント購読（`session.subscribe`）によるリアルタイムストリーミング出力の実装:
  - `message_start` によるアシスタント応答開始検知。
  - `message_update` & `text_delta` による思考・テキストの順次描画。
  - `turn_end` によるターン完了検知と適切な改行。
- [x] ターミナル入力受付（インタラクティブループ）の実装:
  - `readline` の非同期イテレータ（`for await (const line of rl)`）を用いた堅牢な入力ループ。
  - ユーザーからの指示入力 → `session.prompt()` の実行。
  - 特殊コマンド（`/exit`, `/clear`, `/help`, `/model`）のハンドリング。
- [x] 終了時のクリーンアップ処理（`session.dispose()`, `rl.close()`）。

### Step 3: 小説執筆補助の専門コンテキスト組み込み（← 次の着手対象）
- 小説執筆補助に特化したシステムプロンプトの設計:
  - 役割: 作家の思考パートナー（ブレインストーミング、プロット構成、伏線考証、文体推敲）。
  - 対話姿勢: 創作意図を尊重し、一方的な決定ではなく選択肢や壁打ち相手として提案を行う。
- ワークスペース内の設定資料（Markdownファイルなど）を参照できる基礎的な読み込み方針の設計。

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
