import fs from "node:fs";
import path from "node:path";

export interface NavigationResult {
  success: boolean;
  currentDir: string;
  relativeDir: string;
  message: string;
  isHitRootBoundary?: boolean;
}

/**
 * プロジェクト内での階層移動を管理するナビゲーター。
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
   * 指定されたパスがプロジェクトルート配下に収まっているかを検証
   */
  private isWithinRoot(targetPath: string): boolean {
    const rel = path.relative(this.rootDir, targetPath);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  }
}
