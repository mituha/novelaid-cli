import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { fetchLmStudioModels, DEFAULT_LM_STUDIO_URL } from "../model-manager.js";
import { WorkspaceNavigator } from "../workspace/index.js";

/**
 * novelaid-cli 小説執筆補助 InlineExtension
 * Pi Coding Agent SDK の標準機能と統合する拡張機能プラグイン
 */
export function createNovelaidExtension(options?: {
  lmStudioUrl?: string;
  projectDir?: string;
}): InlineExtension {
  const lmStudioUrl = options?.lmStudioUrl || DEFAULT_LM_STUDIO_URL;
  const projectDir = options?.projectDir || process.cwd();
  const navigator = new WorkspaceNavigator(projectDir);

  return {
    name: "novelaid-extension",
    factory: async (api: ExtensionAPI) => {
      // 1. LM Studio プロバイダーの自動登録
      try {
        const fetchedModels = await fetchLmStudioModels(lmStudioUrl);
        if (fetchedModels.length > 0) {
          const sdkModels = fetchedModels.map((m) => ({
            id: m.id,
            name: m.id,
            api: "openai-completions" as const,
            reasoning: false,
            contextWindow: 128000,
            maxTokens: 16384,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            input: ["text" as const],
          }));

          api.registerProvider("lm-studio", {
            name: "LM Studio",
            baseUrl: lmStudioUrl,
            apiKey: "lm-studio",
            api: "openai-completions",
            models: sdkModels,
          });
        }
      } catch {
        // LM Studio が未起動の場合は警告を出さずスキップ（他プロバイダーや/login等の妨げにしない）
      }

      // 2. ディレクトリ現在位置表示コマンド (/pwd)
      api.registerCommand("pwd", {
        description: "現在の作業フォルダーの位置を表示します",
        handler: async (_args, ctx) => {
          const rel = navigator.getRelativeDir();
          const abs = navigator.getCurrentDir();
          ctx.ui.notify(
            `【現在の作業フォルダー】\n` +
            `・相対位置: [${rel}]\n` +
            `・絶対パス: ${abs}\n` +
            `・書庫ルート: ${navigator.rootDir}`,
            "info"
          );
        },
      });

      // 3. ディレクトリ移動コマンド (/cd [パス])
      api.registerCommand("cd", {
        description: "作業フォルダーを移動します（例: /cd 10_novels, /cd ..）",
        handler: async (args, ctx) => {
          const target = args?.trim();
          const result = navigator.changeDirectory(target);
          const notifyType = result.success
            ? (result.isHitRootBoundary ? "warning" : "info")
            : "error";

          ctx.ui.notify(result.message, notifyType);
        },
      });

      // 4. ファイル・フォルダー一覧表示コマンド (/ls, /dir)
      const listHandler = async (args: string | undefined, ctx: { ui: { notify: (msg: string, type?: "info" | "warning" | "error") => void } }) => {
        const target = args?.trim();
        const result = navigator.listEntries(target);
        const formatted = navigator.formatEntries(result);
        ctx.ui.notify(formatted, result.success ? "info" : "error");
      };

      api.registerCommand("ls", {
        description: "現在の作業フォルダー（または指定フォルダー）内の一覧を表示します",
        handler: listHandler,
      });

      api.registerCommand("dir", {
        description: "現在の作業フォルダー（または指定フォルダー）内の一覧を表示します（/ls のエイリアス）",
        handler: listHandler,
      });

      // 5. 小説執筆補助のステータスコマンド (/novelaid-info)
      api.registerCommand("novelaid-info", {
        description: "novelaid-cli の概要と執筆支援ステータスを表示します",
        handler: async (_args, ctx) => {
          ctx.ui.notify(
            "【novelaid-cli】小説執筆補助エージェント (Pi SDK Native Extension)\n" +
            `・作業フォルダー: [${navigator.getRelativeDir()}]\n` +
            `・書庫ルート: ${navigator.rootDir}\n` +
            "・フォルダー移動: /cd <パス>（ルート上限保護あり）\n" +
            "・フォルダー一覧: /ls, /dir [パス]\n" +
            "・現在地表示: /pwd\n" +
            "・モデル管理: /model で選択可能",
            "info"
          );
        },
      });
    },
  };
}
