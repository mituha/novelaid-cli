import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { createAgentSession, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createDefaultCommandRegistry, type CommandContext } from "./commands/index.js";

export interface StartChatSessionOptions {
  runtime: ModelRuntime;
  modelId?: string;
}

/**
 * Pi SDK の AgentSession を利用したインタラクティブ対話ループを開始します。
 */
export async function startChatSession(options: StartChatSessionOptions): Promise<void> {
  const { runtime, modelId } = options;

  // 使用モデルの選定
  const availableModels = runtime.getModels("lm-studio");
  if (availableModels.length === 0) {
    console.error("エラー: 利用可能なモデルが見つかりません。LM Studio を起動してください。");
    return;
  }

  const selectedModel = modelId
    ? availableModels.find((m) => m.id === modelId) ?? availableModels[0]
    : availableModels[0];

  console.log(`\n対話セッションを開始します（モデル: ${selectedModel.id}）`);
  console.log("コマンド: /help (ヘルプ), /model (モデル情報), /clear (画面消去), /exit (終了)\n");

  // AgentSession の初期化
  const { session } = await createAgentSession({
    modelRuntime: runtime,
    model: selectedModel,
    noTools: "all", // 小説執筆の純粋な対話セッションとして開始
  });

  // コマンドレジストリの生成
  const registry = createDefaultCommandRegistry();
  let isExitRequested = false;

  const commandContext: CommandContext = {
    session,
    runtime,
    requestExit: () => {
      isExitRequested = true;
    },
    clearScreen: () => {
      console.clear();
    },
    print: (message: string) => {
      console.log(message);
    },
    currentModel: {
      id: selectedModel.id,
      name: selectedModel.name,
      contextWindow: selectedModel.contextWindow,
    },
  };

  let isAssistantResponding = false;

  // イベント購読によるリアルタイムストリーミング出力
  const unsubscribe = session.subscribe((event) => {
    switch (event.type) {
      case "message_start":
        if (event.message.role === "assistant") {
          isAssistantResponding = true;
          output.write("\nAI> ");
        }
        break;

      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          output.write(event.assistantMessageEvent.delta);
        }
        break;

      case "turn_end":
        if (isAssistantResponding) {
          output.write("\n\n");
          isAssistantResponding = false;
        }
        break;
    }
  });

  const rl = readline.createInterface({
    input,
    output,
    prompt: "作家> ",
  });

  try {
    rl.prompt();

    for await (const rawLine of rl) {
      const userInput = rawLine.trim();

      if (!userInput) {
        rl.prompt();
        continue;
      }

      // スラッシュコマンドの処理（CommandRegistry へ委譲）
      if (userInput.startsWith("/")) {
        await registry.dispatch(userInput, commandContext);
        if (isExitRequested) {
          break;
        }
        rl.prompt();
        continue;
      }

      // ユーザーのプロンプトを AgentSession へ送信
      try {
        await session.prompt(userInput);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\n生成エラー: ${message}\n`);
      }

      rl.prompt();
    }
  } finally {
    unsubscribe();
    session.dispose();
    rl.close();
  }
}
