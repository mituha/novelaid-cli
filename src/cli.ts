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

  try {
    // セッション作成関数の存在と型チェック確認
    if (typeof createAgentSession === "function") {
      console.log("✔ Pi Coding Agent SDK の初期化関数を確認しました。");
    }

    console.log("\n[Step 1] プロジェクト基盤のセットアップが正常に完了しました。");
  } catch (error) {
    console.error("初期化エラー:", error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("予期せぬエラーが発生しました:", err);
  process.exit(1);
});
