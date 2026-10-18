import type { AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * コマンド実行時に渡されるコンテキスト情報
 */
export interface CommandContext {
  /** 現在のアクティブな AgentSession */
  session: AgentSession;
  /** モデルおよび認証を管理する ModelRuntime */
  runtime: ModelRuntime;
  /** セッション対話ループの終了を要求するコールバック */
  requestExit: () => void;
  /** ターミナル画面の消去を実行するコールバック */
  clearScreen: () => void;
  /** ターミナルへのメッセージ出力関数 */
  print: (message: string) => void;
  /** 現在選択されているモデル情報 */
  currentModel: {
    id: string;
    name: string;
    contextWindow: number;
  };
  /** レジストリ自身の参照（/help 等で利用） */
  registry?: CommandRegistryInterface;
}

/**
 * CommandRegistry のインターフェース（循環参照回避用）
 */
export interface CommandRegistryInterface {
  get(nameOrAlias: string): CommandDefinition | undefined;
  getAll(): CommandDefinition[];
  formatHelp(commandName?: string): string;
  dispatch(input: string, context: CommandContext): Promise<boolean>;
}

/**
 * コマンドの宣言的定義
 */
export interface CommandDefinition {
  /** コマンドのプライマリ名（先頭のスラッシュは含めない。例: "help", "model"） */
  name: string;
  /** コマンドの別名（例: ["quit", "q"]） */
  aliases?: string[];
  /** 引数の構文表記（例: "[コマンド名]", "<モデル名>"） */
  usage?: string;
  /** 短い説明（一覧ヘルプ表示用） */
  description: string;
  /** 詳細な説明（/help <コマンド名> で表示する使用方法や仕様） */
  detail?: string;
  /** コマンドの実行ロジック */
  execute: (args: string, context: CommandContext) => Promise<void> | void;
}
