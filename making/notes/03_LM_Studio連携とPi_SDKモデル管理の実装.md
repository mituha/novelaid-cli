# 第3回：ローカルAI（LM Studio）と接続！Pi SDKのモデル管理機能を活用して動的取得と推論テストに成功するまで

こんにちは！小説執筆補助用AIエージェントCLIツール（`novelaid-cli`）の開発メイキング、第3回です。

[前回（第2回）](./02_プロジェクト基盤セットアップと最小CLIの動作確認.md) では、TypeScriptとNode.jsの開発基盤を整備し、コアとなる **Pi Coding Agent SDK** をプロジェクトに組み込んで最小のCLIが起動するところまで進めました。

基盤ができたところで、今回はいよいよ「AIとの対話」に向けた第一歩を踏み出します。小説執筆ではプロットや未公開原稿の秘匿性が非常に重要になるため、ローカルで安全かつ無料で動かせる **LM Studio** への接続を最優先で実装します。

「まずは接続可能かのテストから小さく始める」という開発方針のもと、Pi SDK標準のモデル管理機能をフル活用して、LM Studio内のモデル一覧取得と1往復の推論疎通テストに成功するまでの過程をお届けします！

---

## 1. 今回の課題と入力したプロンプト

CLI対話ループの実装に入る前に、AIモデルへの接続設定やテスト方針について検討を行いました。作家（ユーザー）からのプロンプトはこちらです。

> 次に、CLI対話の実装に入りますが、実装計画を細かく検討してください。  
> 1. AIモデルの接続、設定をどうするか？  
> 1-1. 接続先を対話的に選択するのか、事前に設定するのか  
> 1-2. LM Studioなどでは、使用可能なモデルの取得や使用モデルのLM Studioへの設定が可能か？  
> 2. まず、接続可能かのテスト  
>  
> 実装確認としては接続可能かのテストまでをまず行います。  
> 現状、実装としては、LM Studio での利用のみが確認できれば良いです。  
> 他のモデルへの接続の実装は可能な構造が作成できるようにしてあれば良いものとします。

さらに、SDK標準機能の活用に関して次の質問をいただきました。

> piのSDKの機能としてモデル一覧の取得やモデル設定の機能はないのですか？

### 課題の要点
1. **車輪の再発明を避ける**: 独自に通信クライアントやプロバイダー管理を作るのではなく、Pi Coding Agent SDKの内蔵機能を最大限に生かす。
2. **スモールステップ開発**: 対話ループを作る前に、まずは「LM Studioへの接続とモデル認識、そして1往復の推論ができるか」を単独で検証する（Step 2-1）。
3. **将来の拡張性**: 今回はLM Studio優先ですが、Google Geminiなど他のプロバイダーも同じ仕組みで追加できる設計にする。

---

## 2. AIによる設計・実装プロセス

### ポイント1：Pi SDKの `ModelRuntime` を徹底調査

Pi Coding Agent SDK（`@earendil-works/pi-coding-agent`）の内部コードと型定義を精査したところ、非常に強力なモデル管理ランタイム **`ModelRuntime`** が標準で備わっていることが判明しました。

* `ModelRuntime.create()`: ランタイムの初期化
* `runtime.registerProvider(providerId, config)`: プロバイダー（LM Studio等）の動的登録
* `runtime.checkAuth(providerId)`: 認証・疎通のヘルスチェック
* `runtime.getModels(providerId)`: 登録済みモデル一覧の取得
* `runtime.completeSimple(model, context)`: 単発の推論実行

独自にRESTクライアントを組み立てるのではなく、この `ModelRuntime` にモデルを登録するアプローチをとることで、コードを極めてシンプルかつ堅牢に保つことができます。

### ポイント2：LM Studioエンドポイントから動的にモデルを取得・登録

LM Studio のローカルサーバー（デフォルト: `http://localhost:1234/v1`）は OpenAI 互換の `/v1/models` エンドポイントを提供しています。

これを利用し、以下のようなフローを持つ専用モジュール `src/model-manager.ts` を作成しました。

```mermaid
flowchart TD
    LM[LM Studio サーバー<br/>http://localhost:1234/v1] -->|1. GET /models| MM[model-manager.ts]
    MM -->|2. ProviderChatModelConfig変換| MR[Pi SDK ModelRuntime]
    MR -->|3. registerProvider('lm-studio')| MR
    MR -->|4. getModels / completeSimple| CLI[novelaid-cli]
```

```typescript
// src/model-manager.ts の要約
export async function initializeModelRuntime(options?: { lmStudioUrl?: string }) {
  const lmStudioUrl = options?.lmStudioUrl || DEFAULT_LM_STUDIO_URL;
  const runtime = await ModelRuntime.create({ allowModelNetwork: true });

  try {
    // 1. LM Studio から利用可能なモデル一覧を取得
    const fetched = await fetchLmStudioModels(lmStudioUrl);

    // 2. Pi SDK 形式のモデル設定に変換
    const sdkModels = fetched.map((m) => ({
      id: m.id,
      name: m.id,
      api: "openai-completions" as const,
      reasoning: false,
      contextWindow: 128000,
      maxTokens: 16384,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      input: ["text" as const],
    }));

    // 3. Pi SDK にプロバイダー登録
    runtime.registerProvider("lm-studio", {
      name: "LM Studio",
      baseUrl: lmStudioUrl,
      apiKey: "lm-studio",
      api: "openai-completions",
      models: sdkModels,
    });

    return { runtime, lmStudioStatus: { connected: true, models: sdkModels, ... } };
  } catch (err) {
    return { runtime, lmStudioStatus: { connected: false, error: err.message, ... } };
  }
}
```

### ポイント3：CLIでのモデル一覧表示と `--test` オプション

`src/cli.ts` を拡張し、通常起動時には接続状態と認識モデル一覧を表示し、`--test` オプションが指定された場合は実際に1往復の推論テスト（`runtime.completeSimple`）を行う仕組みを組み込みました。

---

## 3. 実際に動かしてみた結果

### 通常起動（モデル一覧の確認）

```powershell
npm start
```

**出力結果**:
```text
=========================================
  novelaid-cli (小説執筆補助エージェント)  
=========================================
Pi Coding Agent SDK ランタイムを初期化中...

【AIモデル接続ステータス】
✔ ローカルLM Studio: 接続成功 (http://localhost:1234/v1)
  利用可能なモデル数: 9 件
   - [qwen/qwen3-4b-2507] qwen/qwen3-4b-2507 (コンテキスト窓: 128,000 tokens)
   - [lfm2.5-2.6b] lfm2.5-2.6b (コンテキスト窓: 128,000 tokens)
   - [qwen/qwen3-8b] qwen/qwen3-8b (コンテキスト窓: 128,000 tokens)
   - [google/gemma-3-4b] google/gemma-3-4b (コンテキスト窓: 128,000 tokens)
   ...

[Step 2-1] Pi SDK ModelRuntime によるモデル接続・一覧取得テストが完了しました。
```

ローカル環境のLM Studioから、現在ダウンロードされているモデル（9件）が即座に検出され、SDK経由で綺麗にリストアップされました！

### 推論疎通テスト（`--test` オプション）

続いて、実際にモデルが応答を返せるかテストします。

```powershell
npm start -- --test
```

**出力結果**:
```text
【推論疎通テスト（1往復）を実行中...】
テスト対象モデル: qwen/qwen3-4b-2507
モデル応答: "こんにちは！接続テストは正常に完了しました。ご質問やお手伝いが必要な場合は、いつでもどうぞ。"
✔ 推論疎通テストに成功しました！

[Step 2-1] Pi SDK ModelRuntime によるモデル接続・一覧取得テストが完了しました。
```

テスト用プロンプト「こんにちは。接続テストです。」に対し、LM Studio内のローカルLLMが即座に応答を返し、無事に1往復の疎通が完了しました！

---

## 💡 読者の皆さんも手元で動かしてみよう！（手動動作確認の手順）

本プロジェクトのリポジトリをお手元のPCにチェックアウトして、同じように試すことができます。

1. **LM Studio を起動**:
   - LM Studio を起動し、「Developer」タブでローカル推論サーバー（ポート `1234`）をONにします。
   - お好みのローカルモデル（QwenやGemmaなど）をロードしておきます。
2. **依存関係のインストールとビルド**:
   ```powershell
   npm install
   npm run build
   ```
3. **接続・推論テストの実行**:
   ```powershell
   npm start -- --test
   ```

詳しい手動テストの仕様は、[動作確認ガイド](../../docs/manual/動作確認ガイド.md) にもまとめてありますのでぜひご覧ください。

---

## 4. まとめと次回予告

今回は開発計画の **Step 2-1（Pi SDK ModelRuntime によるモデル接続・一覧取得と疎通テスト）** を完了させました。

### 今回の成果
* Pi SDK の `ModelRuntime` を介して、LM Studio のモデルを動的に登録・認識できるようになった。
* `--test` オプションで、実機モデルとの推論疎通（1往復）が正常に行えることを実証できた。
* LM Studio が起動していない場合でも、作家に分かりやすいエラーメッセージを表示する堅牢なエラーハンドリングを整備した。

### 次回予告
いよいよ **Step 2-2（Pi SDKセッション連携とCLI対話UIの実装）** に入ります！  
ターミナル上でユーザーからのプロンプトを受け付け、ローカルAIからの返答をリアルタイムに文字が流れるストリーミング表示で描画するインタラクティブループを実装していきます。どうぞお楽しみに！
