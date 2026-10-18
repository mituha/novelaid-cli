import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
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
            "・フォルダー移動: /cd <パス>（ルート上限保護・Tab補完対応）\n" +
            "・フォルダー一覧: /ls, /dir [パス]\n" +
            "・現在地表示: /pwd\n" +
            "・モデル管理: /model で選択可能",
            "info"
          );
        },
      });

      // 6. /cd, /ls, /dir コマンドのパス引数自動補完プロバイダーの登録
      api.on("session_start", async (_event, ctx) => {
        ctx.ui.addAutocompleteProvider((current: AutocompleteProvider): AutocompleteProvider => {
          return {
            async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
              const currentLine = lines[cursorLine] ?? "";
              const textBeforeCursor = currentLine.slice(0, cursorCol);

              // /cd, /ls, /dir コマンドの引数入力を検出（例: "/cd ", "/cd 10", "/cd 10_novels/"）
              const match = textBeforeCursor.match(/^\s*\/(?:cd|ls|dir)\s+([^\s]*)$/);
              if (!match) {
                return current.getSuggestions(lines, cursorLine, cursorCol, options);
              }

              const rawArg = match[1] ?? "";
              const result = navigator.getFolderSuggestions(rawArg);
              if (result.suggestions.length === 0) {
                return current.getSuggestions(lines, cursorLine, cursorCol, options);
              }

              const items: AutocompleteItem[] = result.suggestions.map((s) => ({
                value: s.path,
                label: s.path,
                description: s.description,
              }));

              return {
                items,
                prefix: result.prefix,
              };
            },

            applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
              return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
            },

            shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
              return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
            },
          };
        });
      });
    },
  };
}
