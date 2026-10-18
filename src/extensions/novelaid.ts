import path from "node:path";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { fetchLmStudioModels, DEFAULT_LM_STUDIO_URL } from "../model-manager.js";
import { WorkspaceNavigator, type NovelaidDocumentType } from "../workspace/index.js";

/**
 * ドキュメントタイプに応じたAI執筆ペルソナ・ガイドラインの取得
 */
export function getPersonaGuideline(docType: NovelaidDocumentType): string {
  switch (docType) {
    case "novel":
      return [
        "The current workspace is for novel manuscript. Focus on literary expression, prose rhythm, dialogue, descriptive details, and emotional depth.",
        "When asked to add ruby/furigana (ルビ振り) or refine text, use the standard format: |親文字《ルビ》 (e.g. |躊躇《ちゅうちょ》, |刹那《せつな》, |本気《マジ》).",
        "Rules for ruby:",
        "- Target difficult kanji, character/place names, and ateji (当て字).",
        "- Apply ruby only to the first appearance of the word in the chapter.",
        "- Never add ruby if the word already has ruby.",
        "- Use the 'edit' tool to apply changes directly to the manuscript file with diff confirmation.",
      ].join("\n");
    case "markdown":
      return "The current workspace is for plot, world settings, characters, or research notes. Focus on logical consistency, cause-and-effect, foreshadowing, and structured outlines.";
    case "chat":
      return "The current workspace is for informal brainstorming or conversational ideation. Engage freely, suggest creative alternatives, and bounce ideas.";
    default:
      return "Provide general novel writing and world-building assistance aligned with the project structure.";
  }
}

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
        description: "現在の作業フォルダーの位置と種別を表示します",
        handler: async (_args, ctx) => {
          const rel = navigator.getRelativeDir();
          const displayRel = !rel || rel === "." ? "(プロジェクトルート)" : rel;
          const abs = navigator.getCurrentDir();
          const docType = navigator.getDirectoryType(abs);
          ctx.ui.notify(
            `【現在の作業フォルダー】\n` +
            `・相対位置: [${displayRel}]\n` +
            `・フォルダー種別: ${docType}\n` +
            `・絶対パス: ${abs}\n` +
            `・書庫ルート: ${navigator.rootDir}`,
            "info"
          );
        },
      });

      // 3. ディレクトリ移動コマンド (/cd [パス])
      api.registerCommand("cd", {
        description: "作業フォルダーを移動します（例: /cd 10_novels, /cd novel, /cd plot, /cd wiki, /cd ..）",
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
          const rel = navigator.getRelativeDir();
          const displayRel = !rel || rel === "." ? "(プロジェクトルート)" : rel;
          const docType = navigator.getDirectoryType(navigator.getCurrentDir());
          ctx.ui.notify(
            "【novelaid-cli】小説執筆補助エージェント (Pi SDK Native Extension)\n" +
            `・作業フォルダー: [${displayRel}] (${docType})\n` +
            `・書庫ルート: ${navigator.rootDir}\n` +
            "・フォルダー移動: /cd <パス | novel | plot | wiki>（セマンティックジャンプ・Tab補完対応）\n" +
            "・フォルダー一覧: /ls, /dir [パス]\n" +
            "・現在地表示: /pwd\n" +
            "・ルビ自動設定: /ruby [ファイル名] (novelaid-ruby 準拠)\n" +
            "・AI文脈連携: 作業フォルダーとDocumentTypeを自動注入\n" +
            "・モデル管理: /model で選択可能",
            "info"
          );
        },
      });

      // 6. ルビ自動設定支援コマンド (/ruby [ファイル名])
      api.registerCommand("ruby", {
        description: "原稿ファイルの難読漢字や固有名詞へのルビ振り支援（novelaid-ruby 準拠）を案内・開始します",
        handler: async (args, ctx) => {
          const target = args?.trim();
          const currentRel = navigator.getRelativeDir();
          const displayRel = !currentRel || currentRel === "." ? "(プロジェクトルート)" : currentRel;

          let targetFile = target;
          if (!targetFile) {
            // カレントフォルダー内のファイル一覧から小説ファイルを探索
            const list = navigator.listEntries();
            const novelFile = list.entries.find(
              (e) => !e.isDirectory && (e.documentType === "novel" || e.name.endsWith(".txt"))
            );
            if (novelFile) {
              targetFile = novelFile.name;
            } else {
              // カレントフォルダーにない場合、小説本文フォルダー(semantic 'novel')配下を自動探索
              const novelFolder = navigator.findSemanticDirectory("novel");
              if (novelFolder) {
                const subList = navigator.listEntries(novelFolder);
                const subNovel = subList.entries.find(
                  (e) => !e.isDirectory && (e.documentType === "novel" || e.name.endsWith(".txt"))
                );
                if (subNovel) {
                  const relFolder = path.relative(navigator.getCurrentDir(), novelFolder).replace(/\\/g, "/");
                  targetFile = relFolder ? `${relFolder}/${subNovel.name}` : subNovel.name;
                }
              }
            }
          }

          if (targetFile) {
            ctx.ui.notify(
              `【ルビ自動設定支援】\n` +
              `・対象原稿: [${targetFile}]（現在地: [${displayRel}]）\n` +
              `・書式: |親文字《ルビ》 (novelaid-ruby / カクヨム・なろう・青空文庫形式)\n` +
              `\n💡 AIに対話で指示してください:\n` +
              `「${targetFile} の難読漢字と固有名詞にルビを振って」\n` +
              `「${targetFile} の登場人物名にルビを付けて」\n` +
              `※AIが原稿を読み込み、初出箇所へ安全に差分編集（edit）を提案します。`,
              "info"
            );
          } else {
            ctx.ui.notify(
              `【ルビ自動設定支援】\n` +
              `現在の作業フォルダー [${displayRel}] 内に小説原稿が見つかりませんでした。\n` +
              `ファイル名を指定して実行してください（例: /ruby 第1話.txt）\n` +
              `または /cd novel で原稿フォルダーへ移動してください。`,
              "warning"
            );
          }
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

      // 7. AIエージェント思考開始前の現在地・DocumentType動的注入
      api.on("before_agent_start", async (event, _ctx) => {
        const rel = navigator.getRelativeDir();
        const activeDir = !rel || rel === "." ? "(root)" : rel;
        const currentDir = navigator.getCurrentDir();
        const dirType = navigator.getDirectoryType(currentDir);
        const persona = getPersonaGuideline(dirType);

        const workspaceContent = [
          `- Active Directory: [${activeDir}]`,
          `- Document Type: ${dirType}`,
          `- Working Scope Rule: When the user refers to files without an explicit directory path (e.g. "第1話.txt" or "setting.md"), look in Active Directory first before the project root.`,
          `- Role Guideline: ${persona}`,
        ].join("\n");

        event.systemPromptOptions.sections["novelaid_workspace"] = workspaceContent;
      });
    },
  };
}
