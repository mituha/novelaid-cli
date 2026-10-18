/**
 * novelaid-cli
 * 小説執筆補助用AIエージェント CLIツール
 */

import { initializeModelRuntime } from "./model-manager.js";

async function main() {
  const args = process.argv.slice(2);
  const isTestMode = args.includes("--test");

  console.log("=========================================");
  console.log("  novelaid-cli (小説執筆補助エージェント)  ");
  console.log("=========================================");
  console.log("Pi Coding Agent SDK ランタイムを初期化中...\n");

  try {
    const { runtime, lmStudioStatus } = await initializeModelRuntime();

    console.log("【AIモデル接続ステータス】");
    if (lmStudioStatus.connected) {
      console.log(`✔ ローカルLM Studio: 接続成功 (${lmStudioStatus.baseUrl})`);
      console.log(`  利用可能なモデル数: ${lmStudioStatus.models.length} 件`);
      for (const model of lmStudioStatus.models) {
        console.log(`   - [${model.id}] ${model.name} (コンテキスト窓: ${model.contextWindow.toLocaleString()} tokens)`);
      }
    } else {
      console.log(`✖ ローカルLM Studio: 未接続 (${lmStudioStatus.baseUrl})`);
      console.log(`  理由: ${lmStudioStatus.error}`);
      console.log("  ※ LM Studio を起動し、ローカルサーバー（ポート1234）を開始してください。");
    }

    if (isTestMode && lmStudioStatus.connected && lmStudioStatus.models.length > 0) {
      console.log("\n【推論疎通テスト（1往復）を実行中...】");
      const testModel = runtime.getModels("lm-studio")[0];
      if (testModel) {
        console.log(`テスト対象モデル: ${testModel.id}`);
        const response = await runtime.completeSimple(testModel, {
          systemPrompt: "あなたは小説執筆のアシスタントです。一言で応答してください。",
          messages: [
            {
              role: "user",
              content: "こんにちは。接続テストです。",
              timestamp: Date.now(),
            },
          ],
        });
        const textParts = response.content?.filter((c) => c.type === "text") ?? [];
        for (const p of textParts) {
          if ("text" in p) {
            console.log(`モデル応答: "${p.text.trim()}"`);
          }
        }
        console.log("✔ 推論疎通テストに成功しました！");
      }
    }

    console.log("\n[Step 2-1] Pi SDK ModelRuntime によるモデル接続・一覧取得テストが完了しました。");
  } catch (error) {
    console.error("初期化エラー:", error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("予期せぬエラーが発生しました:", err);
  process.exit(1);
});
