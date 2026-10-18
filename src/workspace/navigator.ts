import fs from "node:fs";
import path from "node:path";

export interface NavigationResult {
  success: boolean;
  currentDir: string;
  relativeDir: string;
  message: string;
  isHitRootBoundary?: boolean;
}

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
}

export interface ListResult {
  success: boolean;
  targetDir: string;
  relativeDir: string;
  entries: FileEntry[];
  message?: string;
}

/**
 * ファイルサイズを人間が読みやすい形式に整形
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * プロジェクト内での階層移動と一覧表示を管理するナビゲーター。
 * プロジェクトルート（rootDir）を上限とし、ルート外への脱出を安全にブロックします。
 */
export class WorkspaceNavigator {
  readonly rootDir: string;
  private currentDir: string;

  constructor(rootDir: string, initialDir?: string) {
    this.rootDir = path.resolve(rootDir);
    this.currentDir = initialDir ? path.resolve(initialDir) : this.rootDir;

    // 初期ディレクトリの境界チェック
    if (!this.isWithinRoot(this.currentDir)) {
      this.currentDir = this.rootDir;
    }
  }

  /**
   * 現在の作業ディレクトリ（絶対パス）を取得
   */
  getCurrentDir(): string {
    return this.currentDir;
  }

  /**
   * プロジェクトルートからの相対パスを取得（例: "." または "10_novels/01_..."）
   */
  getRelativeDir(): string {
    const rel = path.relative(this.rootDir, this.currentDir);
    return rel === "" ? "." : rel.replace(/\\/g, "/");
  }

  /**
   * ディレクトリを変更する
   * @param targetInput 移動先パス（未指定の場合はプロジェクトルートへ復帰）
   */
  changeDirectory(targetInput?: string): NavigationResult {
    // 1. 引数なし、または "~" や "/" のみの場合はプロジェクトルートへ復帰
    if (!targetInput || targetInput.trim() === "" || targetInput.trim() === "~" || targetInput.trim() === "/") {
      this.currentDir = this.rootDir;
      return {
        success: true,
        currentDir: this.currentDir,
        relativeDir: ".",
        message: `プロジェクトルート (${path.basename(this.rootDir)}/) に移動しました。`,
      };
    }

    const trimmed = targetInput.trim();
    const candidatePath = path.resolve(this.currentDir, trimmed);

    // 2. ルート上限ガード（プロジェクトルートより外側への脱出を防止）
    if (!this.isWithinRoot(candidatePath)) {
      this.currentDir = this.rootDir;
      return {
        success: true,
        currentDir: this.rootDir,
        relativeDir: ".",
        message: `プロジェクトルートが上限です。外側へは移動できないため、ルート (${path.basename(this.rootDir)}/) に移動しました。`,
        isHitRootBoundary: true,
      };
    }

    // 3. 存在確認
    if (!fs.existsSync(candidatePath)) {
      return {
        success: false,
        currentDir: this.currentDir,
        relativeDir: this.getRelativeDir(),
        message: `フォルダーが存在しません: "${trimmed}"`,
      };
    }

    // 4. ディレクトリ確認
    const stat = fs.statSync(candidatePath);
    if (!stat.isDirectory()) {
      return {
        success: false,
        currentDir: this.currentDir,
        relativeDir: this.getRelativeDir(),
        message: `指定されたパスはディレクトリではありません: "${trimmed}"`,
      };
    }

    // 5. 成功：現在位置を更新
    this.currentDir = candidatePath;
    const rel = this.getRelativeDir();
    return {
      success: true,
      currentDir: this.currentDir,
      relativeDir: rel,
      message: `作業フォルダーを移動しました: [${rel}]`,
    };
  }

  /**
   * 指定フォルダー（または現在フォルダー）配下のファイル・フォルダー一覧を取得
   * @param targetInput 対象パス（未指定時は現在作業フォルダー）
   */
  listEntries(targetInput?: string): ListResult {
    let targetPath = this.currentDir;
    if (targetInput && targetInput.trim() !== "") {
      targetPath = path.resolve(this.currentDir, targetInput.trim());
    }

    // ルート外チェック
    if (!this.isWithinRoot(targetPath)) {
      return {
        success: false,
        targetDir: targetPath,
        relativeDir: this.getRelativeDir(),
        entries: [],
        message: "プロジェクトルート外のフォルダーは参照できません。",
      };
    }

    // 存在確認
    if (!fs.existsSync(targetPath)) {
      return {
        success: false,
        targetDir: targetPath,
        relativeDir: this.getRelativeDir(),
        entries: [],
        message: `フォルダーが存在しません: "${targetInput?.trim()}"`,
      };
    }

    // ディレクトリ確認
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      return {
        success: false,
        targetDir: targetPath,
        relativeDir: this.getRelativeDir(),
        entries: [],
        message: `指定されたパスはディレクトリではありません: "${targetInput?.trim()}"`,
      };
    }

    const rel = path.relative(this.rootDir, targetPath);
    const relDisplay = rel === "" ? "." : rel.replace(/\\/g, "/");

    try {
      const dirEntries = fs.readdirSync(targetPath, { withFileTypes: true });
      const dirs: FileEntry[] = [];
      const files: FileEntry[] = [];

      for (const ent of dirEntries) {
        // 隠しファイル・フォルダーは除外
        if (ent.name.startsWith(".")) continue;

        if (ent.isDirectory()) {
          dirs.push({ name: ent.name, isDirectory: true });
        } else if (ent.isFile()) {
          try {
            const fileStat = fs.statSync(path.join(targetPath, ent.name));
            files.push({ name: ent.name, isDirectory: false, size: fileStat.size });
          } catch {
            files.push({ name: ent.name, isDirectory: false });
          }
        }
      }

      // 名前順ソート（日本語ロケール考慮）
      dirs.sort((a, b) => a.name.localeCompare(b.name, "ja"));
      files.sort((a, b) => a.name.localeCompare(b.name, "ja"));

      return {
        success: true,
        targetDir: targetPath,
        relativeDir: relDisplay,
        entries: [...dirs, ...files],
      };
    } catch (err) {
      return {
        success: false,
        targetDir: targetPath,
        relativeDir: relDisplay,
        entries: [],
        message: `一覧の取得に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * 一覧結果を画面表示用テキストに整形
   */
  formatEntries(result: ListResult): string {
    if (!result.success) {
      return result.message || "一覧の取得に失敗しました。";
    }

    const total = result.entries.length;
    if (total === 0) {
      return `📂 フォルダー: [${result.relativeDir}] (空のフォルダー)`;
    }

    const lines: string[] = [`📂 フォルダー: [${result.relativeDir}] (合計: ${total}件)`];
    for (const ent of result.entries) {
      if (ent.isDirectory) {
        lines.push(`  📁 [DIR]  ${ent.name}/`);
      } else {
        const sizeStr = ent.size !== undefined ? ` (${formatFileSize(ent.size)})` : "";
        lines.push(`  📄 [FILE] ${ent.name}${sizeStr}`);
      }
    }
    return lines.join("\n");
  }

  /**
   * 指定されたパスがプロジェクトルート配下に収まっているかを検証
   */
  private isWithinRoot(targetPath: string): boolean {
    const rel = path.relative(this.rootDir, targetPath);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  }
}
