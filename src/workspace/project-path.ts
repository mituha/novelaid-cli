import fs from "node:fs";
import path from "node:path";

export interface ProjectPathResult {
  projectDir: string;
  isCustom: boolean;
  remainingArgs: string[];
}

/**
 * CLI引数からプロジェクトフォルダーパス（-p / --project / 位置引数）を抽出し、
 * 存在確認と絶対パス解決を行います。
 */
export function resolveProjectDirectory(rawArgs: string[]): ProjectPathResult {
  let projectPathInput: string | undefined;
  const remainingArgs: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (arg === "-p" || arg === "--project") {
      if (i + 1 < rawArgs.length) {
        projectPathInput = rawArgs[i + 1];
        i++; // パス引数をスキップ
      } else {
        throw new Error("オプション `-p` / `--project` にはディレクトリパスの指定が必要です。");
      }
    } else if (arg.startsWith("-p=")) {
      projectPathInput = arg.slice(3);
    } else if (arg.startsWith("--project=")) {
      projectPathInput = arg.slice(10);
    } else {
      // ハイフンで始まらない最初の位置引数をプロジェクトパス候補として解釈
      // （ただし --test や --simple 等の引数の後ろで、ファイルやパスに見えるもの）
      if (!projectPathInput && !arg.startsWith("-") && (arg.includes("/") || arg.includes("\\") || fs.existsSync(path.resolve(process.cwd(), arg)))) {
        projectPathInput = arg;
      } else {
        remainingArgs.push(arg);
      }
    }
  }

  const isCustom = Boolean(projectPathInput);
  const targetPath = projectPathInput ? path.resolve(process.cwd(), projectPathInput) : process.cwd();

  // 存在チェック
  if (!fs.existsSync(targetPath)) {
    throw new Error(`指定されたプロジェクトフォルダーが存在しません: "${targetPath}"`);
  }

  // ディレクトリ判定
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    throw new Error(`指定されたパスはディレクトリではありません: "${targetPath}"`);
  }

  return {
    projectDir: targetPath,
    isCustom,
    remainingArgs,
  };
}
