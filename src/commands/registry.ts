import type { CommandDefinition, CommandContext, CommandRegistryInterface } from "./types.js";

/**
 * CLI対話セッション内のスラッシュコマンドを一元管理するレジストリクラス
 */
export class CommandRegistry implements CommandRegistryInterface {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly aliasMap = new Map<string, string>();

  /**
   * コマンドを登録します。
   */
  register(command: CommandDefinition): void {
    const primaryName = command.name.toLowerCase();
    if (this.commands.has(primaryName) || this.aliasMap.has(primaryName)) {
      throw new Error(`コマンド名 '${primaryName}' は既に登録されています。`);
    }

    this.commands.set(primaryName, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        const lowerAlias = alias.toLowerCase();
        if (this.commands.has(lowerAlias) || this.aliasMap.has(lowerAlias)) {
          throw new Error(`エイリアス '${lowerAlias}' は既に他のコマンドで使用されています。`);
        }
        this.aliasMap.set(lowerAlias, primaryName);
      }
    }
  }

  /**
   * 指定された名前またはエイリアスに対応するコマンド定義を取得します。
   */
  get(nameOrAlias: string): CommandDefinition | undefined {
    const lower = nameOrAlias.toLowerCase();
    const primaryName = this.aliasMap.get(lower) ?? lower;
    return this.commands.get(primaryName);
  }

  /**
   * 登録されている全コマンド定義の一覧を取得します（重複なし）。
   */
  getAll(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /**
   * 入力文字列を解析し、該当するコマンドを実行します。
   * @returns スラッシュコマンドとして処理された場合は true、通常プロンプトの場合は false
   */
  async dispatch(input: string, context: CommandContext): Promise<boolean> {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) {
      return false;
    }

    // 先頭のスラッシュを除去してコマンド名と引数に分割
    const content = trimmed.slice(1).trim();
    const spaceIndex = content.search(/\s/);
    const commandName = spaceIndex === -1 ? content : content.slice(0, spaceIndex);
    const args = spaceIndex === -1 ? "" : content.slice(spaceIndex).trim();

    if (!commandName) {
      context.print("コマンド名を入力してください。（/help で利用可能なコマンド一覧を表示できます）\n");
      return true;
    }

    const command = this.get(commandName);
    if (!command) {
      context.print(`未定義のコマンドです: /${commandName} （/help でコマンド一覧を確認できます）\n`);
      return true;
    }

    try {
      context.registry = this;
      await command.execute(args, context);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      context.print(`コマンド /${commandName} の実行中にエラーが発生しました: ${message}\n`);
    }

    return true;
  }

  /**
   * ヘルプメッセージを整形して返します。
   */
  formatHelp(commandName?: string): string {
    if (commandName) {
      // 個別詳細ヘルプ
      const target = commandName.startsWith("/") ? commandName.slice(1) : commandName;
      const cmd = this.get(target);
      if (!cmd) {
        return `指定されたコマンド '/${target}' は存在しません。（/help で全コマンド一覧を確認できます）\n`;
      }

      const lines: string[] = [];
      lines.push(`【コマンド詳細: /${cmd.name}】`);
      lines.push(`構文: /${cmd.name}${cmd.usage ? ` ${cmd.usage}` : ""}`);
      lines.push(`エイリアス: ${cmd.aliases && cmd.aliases.length > 0 ? cmd.aliases.map((a) => `/${a}`).join(", ") : "なし"}`);
      lines.push(`概要: ${cmd.description}`);

      if (cmd.detail) {
        lines.push("\n[詳細説明]");
        lines.push(cmd.detail);
      }
      lines.push("");
      return lines.join("\n");
    }

    // 全コマンド一覧ヘルプ
    const all = this.getAll();
    const lines: string[] = [];
    lines.push("【利用可能なコマンド一覧】");

    // 整列用の最大幅を計算
    const cmdWidths = all.map((c) => {
      const syntax = `/${c.name}${c.usage ? ` ${c.usage}` : ""}`;
      return syntax.length;
    });
    const maxWidth = Math.max(16, ...cmdWidths) + 2;

    for (const cmd of all) {
      const syntax = `/${cmd.name}${cmd.usage ? ` ${cmd.usage}` : ""}`;
      const padding = " ".repeat(Math.max(2, maxWidth - syntax.length));
      const aliasText = cmd.aliases && cmd.aliases.length > 0
        ? ` (別名: ${cmd.aliases.map((a) => `/${a}`).join(", ")})`
        : "";
      lines.push(`  ${syntax}${padding}${cmd.description}${aliasText}`);
    }

    lines.push("\n※ 各コマンドの詳細な使い方は「/help <コマンド名>」で確認できます。\n");
    return lines.join("\n");
  }
}
