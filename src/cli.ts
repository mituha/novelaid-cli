/**
 * novelaid-cli
 * 小説執筆補助用AIエージェント CLIツール
 */

import { main as runPiMain } from "@earendil-works/pi-coding-agent";
import { initializeModelRuntime } from "./model-manager.js";
import { startChatSession } from "./chat-session.js";
import { createNovelaidExtension } from "./extensions/novelaid.js";
import { resolveProjectDirectory } from "./workspace/index.js";

async function main() {
  const rawArgs = process.argv.slice(2);

  // プロジェクトフォルダーの解決
  let projectDir: string;
  let isCustomProject: boolean;
  let args: string[];
  try {
    const resolved = resolveProjectDirectory(rawArgs);
    projectDir = resolved.projectDir;
    isCustomProject = resolved.isCustom;
    args = resolved.remainingArgs;

    // プロセス全体のカレントディレクトリを作業対象プロジェクトに設定
    process.chdir(projectDir);
  } catch (err: any) {
    console.error(`エラー: ${err.message}`);
    process.exit(1);
  }

  // 1. --test モード: 単発の推論テスト
  if (args.includes("--test")) {
    console.log("=========================================");
    console.log("  novelaid-cli (小説執筆補助エージェント)  ");
    console.log("=========================================");
    console.log(`プロジェクトフォルダー: ${projectDir} ${isCustomProject ? "(指定)" : "(デフォルト)"}`);
    console.log("Pi Coding Agent SDK ランタイムを初期化中...\n");

    const { runtime, lmStudioStatus } = await initializeModelRuntime();
    console.log("【AIモデル接続ステータス】");
    if (lmStudioStatus.connected) {
      console.log(`✔ ローカルLM Studio: 接続成功 (${lmStudioStatus.baseUrl})`);
      console.log(`  利用可能なモデル数: ${lmStudioStatus.models.length} 件`);
      for (const model of lmStudioStatus.models) {
        console.log(`   - [${model.id}] ${model.name} (コンテキスト窓: ${model.contextWindow.toLocaleString()} tokens)`);
      }

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
    } else {
      console.log(`✖ ローカルLM Studio: 未接続 (${lmStudioStatus.baseUrl})`);
      console.log(`  理由: ${lmStudioStatus.error}`);
    }
    return;
  }

  // 2. --simple モード: 軽量 readline 対話セッション
  if (args.includes("--simple")) {
    console.log("=========================================");
    console.log("  novelaid-cli (軽量 readline モード)     ");
    console.log("=========================================");
    const { runtime, lmStudioStatus } = await initializeModelRuntime();
    if (!lmStudioStatus.connected) {
      console.error(`エラー: LM Studio に接続できませんでした (${lmStudioStatus.error})`);
      process.exit(1);
    }
    await startChatSession({ runtime });
    return;
  }

  // 3. 通常起動: Pi Coding Agent SDK 標準フルTUI（InteractiveMode）
  // 小説執筆専用の InlineExtension を注入して起動
  const novelaidExtension = createNovelaidExtension({ projectDir });
  await runPiMain(args, {
    extensionFactories: [novelaidExtension],
  });
}

main().catch((err) => {
  console.error("予期せぬエラーが発生しました:", err);
  process.exit(1);
});
