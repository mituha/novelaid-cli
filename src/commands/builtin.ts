import { CommandRegistry } from "./registry.js";
import type { CommandDefinition } from "./types.js";

/**
 * ビルトインの /help コマンド
 */
export const helpCommand: CommandDefinition = {
  name: "help",
  aliases: ["?"],
  usage: "[コマンド名]",
  description: "利用可能なコマンド一覧、または特定コマンドの詳細ヘルプを表示します",
  detail:
    "引数を指定せずに実行した場合は、利用可能な全コマンドの一覧と概要を表示します。\n" +
    "引数にコマンド名（例: /help model）を指定した場合は、そのコマンドの構文や詳しい使用方法を表示します。",
  execute: (args, context) => {
    if (context.registry) {
      context.print(context.registry.formatHelp(args || undefined));
    }
  },
};

/**
 * ビルトインの /model コマンド
 */
export const modelCommand: CommandDefinition = {
  name: "model",
  usage: "[モデル名]",
  description: "現在のモデル情報を表示します",
  detail:
    "現在セッションに設定されているAIモデルのID、表示名、およびコンテキスト窓サイズを表示します。\n" +
    "（将来のバージョンでは、引数にモデル名を指定しての動的切り替えに対応予定です）",
  execute: (args, context) => {
    const { currentModel } = context;
    if (!args) {
      context.print(
        `\n【現在のモデル情報】\n` +
        `  モデル名: ${currentModel.name}\n` +
        `  モデルID: ${currentModel.id}\n` +
        `  コンテキスト窓: ${currentModel.contextWindow.toLocaleString()} tokens\n`
      );
    } else {
      context.print(`※ モデルの動的切り替え機能は現在開発中です。（指定: ${args}）\n`);
    }
  },
};

/**
 * ビルトインの /clear コマンド
 */
export const clearCommand: CommandDefinition = {
  name: "clear",
  aliases: ["cls"],
  description: "ターミナル画面を消去します",
  detail: "ターミナルの表示内容をクリアして画面をすっきりさせます。",
  execute: (_args, context) => {
    context.clearScreen();
  },
};

/**
 * ビルトインの /exit コマンド
 */
export const exitCommand: CommandDefinition = {
  name: "exit",
  aliases: ["quit", "q"],
  description: "対話セッションを終了してCLIを抜けます",
  detail: "進行中の対話セッションを安全に保存・破棄し、CLIツールを終了します。",
  execute: (_args, context) => {
    context.print("対話セッションを終了します。執筆お疲れ様でした！");
    context.requestExit();
  },
};

/**
 * 標準のビルトインコマンド群を登録した CommandRegistry を生成します。
 */
export function createDefaultCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(helpCommand);
  registry.register(modelCommand);
  registry.register(clearCommand);
  registry.register(exitCommand);
  return registry;
}
