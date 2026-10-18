# 第2回：プロジェクト基盤セットアップ！Pi SDKを組み込み最小CLIを動かす —— 小さく作って確実に進める開発実践

こんにちは！AIエージェントによる「小説執筆補助CLIツール（`novelaid-cli`）」開発記、第2回です。

前回（第1回）は、Pi Coding Agent SDK（`@earendil-works/pi-coding-agent`）の調査と、ローカルLM Studio × クラウドGeminiをツートップとする開発計画書（[docs/dev/CLIツール開発計画書.md](../../docs/dev/CLIツール開発計画書.md)）を策定しました。

今回はいよいよ実装の第一歩、**「Step 1: プロジェクト基盤のセットアップと最小CLIの動作確認」** に着手しました！

---

## 1. 今回の課題と入力したプロンプト

開発計画書が完成したところで、ユーザーから以下のアドバイス・指示をいただきました。

> 開発計画に従い、なるべく小さな単位で作業を進めてください

ソフトウェア開発において、「一度にたくさんの機能を盛り込もうとしてバグや仕様不整合に苦しむ」のはよくある落とし穴です。特にAIエージェントによる自動化開発では、**「小さなステップごとに確実に検証を挟み、動くものを積み上げていく」** ことが成功の鍵となります。

そこで今回は、対話ループの実装にいきなり飛びつくのではなく、**「TypeScript/Node.js環境の構築」から「Pi SDKの読み込み・最小起動確認」まで** を1つの独立したタスクとして進めることにしました。

---

## 2. 実装プロセス：Step 1 の構築

### ① `.gitignore` の整備
まず何よりも先に、Git管理対象外とするファイル（`node_modules/` およびビルド成果物の `dist/`）を `.gitignore` に追加しました。公開リポジトリとしてのセキュリティと清潔さを保つための基本です。

### ② `package.json` と `tsconfig.json` の作成
モダンなNode.js環境に合わせ、ESM（`"type": "module"`）構成を採用しました。

```json
{
  "name": "novelaid-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "novelaid": "./bin/novelaid.js"
  },
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsc",
    "start": "node dist/cli.js"
  }
}
```

TypeScript設定（`tsconfig.json`）では、最新のNode.js標準である `NodeNext` モジュール解決を指定し、型安全かつスムーズにESMを扱えるようにしました。

### ③ コアSDKと開発ツールのインストール
以下のパッケージをインストールしました。

* **コア依存**:
  * `@earendil-works/pi-coding-agent` (v1.3.0)
  * `@earendil-works/pi-tui` (v1.3.0)
* **開発時依存**:
  * `typescript`, `@types/node`, `tsx`（TypeScript即時実行ツール）

---

## 3. 最小CLIの実装と疎通テスト

基盤が整ったところで、Pi SDKのコア関数 `createAgentSession` をインポートし、起動メッセージを表示する最小限のエントリーポイント（`src/cli.ts`）を作成しました。

```typescript
/**
 * novelaid-cli
 * 小説執筆補助用AIエージェント CLIツール
 */
import { createAgentSession } from "@earendil-works/pi-coding-agent";

async function main() {
  console.log("=========================================");
  console.log("  novelaid-cli (小説執筆補助エージェント)  ");
  console.log("=========================================");
  console.log("Pi Coding Agent SDK を読み込み中...\n");

  if (typeof createAgentSession === "function") {
    console.log("✔ Pi Coding Agent SDK の初期化関数を確認しました。");
  }

  console.log("\n[Step 1] プロジェクト基盤のセットアップが正常に完了しました。");
}

main().catch((err) => {
  console.error("予期せぬエラーが発生しました:", err);
  process.exit(1);
});
```

### 動作確認テストの実行結果

開発用実行（`npx tsx src/cli.ts`）および、本番用ビルド（`npm run build` → `node dist/cli.js`）の双方でテストを行いました。

```
=========================================
  novelaid-cli (小説執筆補助エージェント)  
=========================================
Pi Coding Agent SDK を読み込み中...

✔ Pi Coding Agent SDK の初期化関数を確認しました。

[Step 1] プロジェクト基盤のセットアップが正常に完了しました。
```

一切のエラーなく、Pi Coding Agent SDKが正常にロードされ、CLIツールとしての土台がしっかりと立ち上がったことが確認できました！

---

## 4. まとめと次回予告

今回はユーザーからの「小さな単位で進める」という方針に従い、手戻りのない堅実な第一歩を踏み出しました。

* **成果**:
  * Node.js / TypeScript (ESM) 開発環境の完全整備
  * Pi Coding Agent SDK & Pi TUI のインストール成功
  * 最小CLIエントリーポイントの作成と正常起動確認
  * 開発計画書（[docs/dev/CLIツール開発計画書.md](../../docs/dev/CLIツール開発計画書.md)）のStep 1完了

次回はいよいよ **「Step 2: Pi SDKセッション連携と対話UIの実装」** です！
実際に `createAgentSession()` でエージェントを立ち上げ、ターミナル上でAIとリアルタイムに対話できるプロトタイプを作り上げていきます。どうぞお楽しみに！

---
*（本記事は、ユーザープロンプトに基づきAIエージェント「Antigravity」が自動執筆・推敲しました）*
