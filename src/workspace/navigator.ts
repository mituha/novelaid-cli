import fs from "node:fs";
import path from "node:path";
import { NovelaidDocumentType, DocumentMetadata } from "./types.js";
import { NovelaidAttributesManager } from "./attributes.js";
import { parseFrontmatter } from "./frontmatter.js";

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
  documentType?: NovelaidDocumentType;
  size?: number;
}

export interface ListResult {
  success: boolean;
  targetDir: string;
  relativeDir: string;
  entries: FileEntry[];
  message?: string;
}

export interface FolderSuggestion {
  name: string;
  path: string;
  description?: string;
}

export interface FolderSuggestionResult {
  suggestions: FolderSuggestion[];
  prefix: string;
}

export type SemanticCategory = "novel" | "plot" | "wiki" | "setting" | "root";

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
  readonly attributesManager: NovelaidAttributesManager;
  private currentDir: string;

  constructor(rootDir: string, initialDir?: string) {
    this.rootDir = path.resolve(rootDir);
    this.currentDir = initialDir ? path.resolve(initialDir) : this.rootDir;
    this.attributesManager = new NovelaidAttributesManager();

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
   * ファイルパスからドキュメントタイプ（NovelaidDocumentType）を判定
   */
  getDocumentType(filePath: string): NovelaidDocumentType {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.ch') return 'chat';
    if (ext === '.css') return 'css';
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
      return 'image';
    }
    if (ext === '.txt') return 'novel';
    if (ext !== '.md' && ext !== '.markdown') return 'unknown';

    // マークダウンファイルに対する .novelaidattributes の判定
    const resolvedPath = path.resolve(filePath);
    const dirPath = path.dirname(resolvedPath);
    const fileName = path.basename(resolvedPath);

    const attrType = this.attributesManager.resolveFileType(dirPath, fileName);
    if (attrType) {
      return attrType as NovelaidDocumentType;
    }

    return 'markdown';
  }

  /**
   * ディレクトリパスから優先ドキュメントタイプ（NovelaidDocumentType）を判定
   * 1. 自身の .novelaidattributes (`./`)
   * 2. 親の .novelaidattributes (`dirName/`)
   * 3. フォルダー名のキーワード判定 (novel/小説, 設定/プロット/資料/wiki, image/画像, chat/チャット/channel/チャンネル)
   * 4. 親フォルダーからの再帰継承
   * 5. デフォルト: 'novel'
   */
  getDirectoryType(dirPath?: string): NovelaidDocumentType {
    const resolvedDir = dirPath ? path.resolve(dirPath) : this.currentDir;

    // 1. 自身の ./ または親からの dirName/ による判定
    const attrType = this.attributesManager.resolveDirectoryType(resolvedDir);
    if (attrType) {
      return attrType as NovelaidDocumentType;
    }

    // 2. キーワードによる判定
    const dirName = path.basename(resolvedDir).toLowerCase();
    const novelKeywords = ['novel', '小説'];
    const markdownKeywords = ['設定', 'プロット', '資料', 'wiki'];
    const imageKeywords = ['image', '画像'];
    const chatKeywords = ['chat', 'チャット', 'channel', 'チャンネル'];

    if (novelKeywords.some((kw) => dirName.includes(kw))) return 'novel';
    if (markdownKeywords.some((kw) => dirName.includes(kw))) return 'markdown';
    if (imageKeywords.some((kw) => dirName.includes(kw))) return 'image';
    if (chatKeywords.some((kw) => dirName.includes(kw))) return 'chat';

    // 3. 親フォルダーの継承（プロジェクトルート上限まで）
    const parentPath = path.dirname(resolvedDir);
    if (parentPath !== resolvedDir && this.isWithinRoot(parentPath) && parentPath !== this.rootDir) {
      return this.getDirectoryType(parentPath);
    }

    // 4. デフォルト
    return 'novel';
  }

  /**
   * ファイルから YAML Front Matter メタデータを抽出
   */
  parseDocumentMetadata(filePath: string): DocumentMetadata {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return parseFrontmatter(content).metadata;
    } catch {
      return {};
    }
  }

  /**
   * プロジェクト内のセマンティックフォルダーを探索
   * @param category カテゴリ名 ("novel" | "plot" | "wiki" | "setting" | "root")
   */
  findSemanticDirectory(category: SemanticCategory): string | null {
    if (category === "root") {
      return this.rootDir;
    }

    let pattern: RegExp;
    if (category === "novel") {
      pattern = /novel|小説/i;
    } else if (category === "plot") {
      pattern = /plot|プロット/i;
    } else {
      // wiki or setting
      pattern = /setting|設定|wiki|資料/i;
    }

    try {
      // 1. ルート直下のフォルダーを走査
      const rootEntries = fs.readdirSync(this.rootDir, { withFileTypes: true });
      for (const ent of rootEntries) {
        if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
        if (pattern.test(ent.name)) {
          return path.join(this.rootDir, ent.name);
        }
      }

      // 2. ルート直下で見つからなければ、深度2まで走査
      for (const ent of rootEntries) {
        if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
        const subDir = path.join(this.rootDir, ent.name);
        try {
          const subEntries = fs.readdirSync(subDir, { withFileTypes: true });
          for (const sub of subEntries) {
            if (!sub.isDirectory() || sub.name.startsWith(".")) continue;
            if (pattern.test(sub.name)) {
              return path.join(subDir, sub.name);
            }
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    return null;
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

    // セマンティックキーワード判定（例: "novel", "novel 01_第1巻", "plot", "wiki", "setting", "root"）
    const semanticMatch = trimmed.match(/^([a-zA-Z0-9_-]+)(?:[\s/]+(.*))?$/);
    const semanticToken = semanticMatch ? (semanticMatch[1]?.toLowerCase() as SemanticCategory) : undefined;
    const isSemanticKey = semanticToken && ["novel", "plot", "wiki", "setting", "root"].includes(semanticToken);

    let candidatePath: string;
    let isSemanticJump = false;

    // 通常の相対パス候補
    const normalCandidate = path.resolve(this.currentDir, trimmed);

    // カレント直下に指定と同名の実フォルダーが存在する場合は通常相対移動を優先
    if (fs.existsSync(normalCandidate)) {
      candidatePath = normalCandidate;
    } else if (isSemanticKey && semanticToken) {
      // セマンティックフォルダー探索
      const baseSemanticDir = this.findSemanticDirectory(semanticToken);
      if (baseSemanticDir) {
        isSemanticJump = true;
        const subPath = semanticMatch?.[2]?.trim();
        candidatePath = subPath ? path.resolve(baseSemanticDir, subPath) : baseSemanticDir;
      } else {
        candidatePath = normalCandidate;
      }
    } else {
      candidatePath = normalCandidate;
    }

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

    if (isSemanticJump && semanticToken) {
      const jumpLabels: Record<SemanticCategory, string> = {
        novel: "小説本文フォルダー",
        plot: "プロットフォルダー",
        wiki: "設定フォルダー",
        setting: "設定フォルダー",
        root: "プロジェクトルート",
      };
      const label = jumpLabels[semanticToken] || "セマンティックフォルダー";
      return {
        success: true,
        currentDir: this.currentDir,
        relativeDir: rel,
        message: `[ジャンプ] ${label}に移動しました: [${rel}]`,
      };
    }

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

        const fullPath = path.join(targetPath, ent.name);

        if (ent.isDirectory()) {
          const docType = this.getDirectoryType(fullPath);
          dirs.push({ name: ent.name, isDirectory: true, documentType: docType });
        } else if (ent.isFile()) {
          const docType = this.getDocumentType(fullPath);
          try {
            const fileStat = fs.statSync(fullPath);
            files.push({ name: ent.name, isDirectory: false, documentType: docType, size: fileStat.size });
          } catch {
            files.push({ name: ent.name, isDirectory: false, documentType: docType });
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
      const typeTag = ent.documentType ? `[${ent.documentType}] ` : "";
      if (ent.isDirectory) {
        lines.push(`  📁 [DIR]  ${ent.name}/ (${ent.documentType || 'unknown'})`);
      } else {
        const sizeStr = ent.size !== undefined ? ` (${formatFileSize(ent.size)})` : "";
        lines.push(`  📄 ${typeTag}${ent.name}${sizeStr}`);
      }
    }
    return lines.join("\n");
  }

  /**
   * /cd 等のパス入力に対するフォルダー補完候補を取得
   * @param rawArg 入力途中の引数（例: "" や "10" や "10_novels/01"）
   */
  getFolderSuggestions(rawArg: string = ""): FolderSuggestionResult {
    // スラッシュを正規化
    const normalized = rawArg.replace(/\\/g, "/");

    // ディレクトリ部分とプレフィックス部分に分割
    const lastSlashIndex = normalized.lastIndexOf("/");
    let searchDirRel = "";
    let prefix = normalized;

    if (lastSlashIndex >= 0) {
      searchDirRel = normalized.slice(0, lastSlashIndex);
      prefix = normalized.slice(lastSlashIndex + 1);
    }

    // 検索対象フォルダーの絶対パスを解決
    const searchTarget = searchDirRel ? path.resolve(this.currentDir, searchDirRel) : this.currentDir;

    // ルート外チェック
    if (!this.isWithinRoot(searchTarget) || !fs.existsSync(searchTarget)) {
      return { suggestions: [], prefix };
    }

    try {
      const stat = fs.statSync(searchTarget);
      if (!stat.isDirectory()) {
        return { suggestions: [], prefix };
      }

      const entries = fs.readdirSync(searchTarget, { withFileTypes: true });
      const suggestions: FolderSuggestion[] = [];

      // 親ディレクトリへの移動候補（..）
      // プロジェクトルートにいない場合、かつ prefix が "." または ".." の前方に一致、あるいは空の場合に提示
      const canGoUp = searchTarget !== this.rootDir;
      if (canGoUp && (prefix === "" || "..".startsWith(prefix))) {
        suggestions.push({
          name: "..",
          path: "../",
          description: "親フォルダー",
        });
      }

      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (ent.name.startsWith(".")) continue; // 隠しディレクトリは除外

        // プレフィックス一致（大文字小文字を区別せず比較）
        if (prefix === "" || ent.name.toLowerCase().startsWith(prefix.toLowerCase())) {
          suggestions.push({
            name: ent.name,
            path: `${ent.name}/`,
            description: "フォルダー",
          });
        }
      }

      // セマンティック予約語の補完候補（引数の第1階層入力時のみ提示）
      if (searchDirRel === "") {
        const semanticKeywords: Array<{ name: SemanticCategory; desc: string }> = [
          { name: "novel", desc: "[ジャンプ] 小説本文フォルダー" },
          { name: "plot", desc: "[ジャンプ] プロットフォルダー" },
          { name: "wiki", desc: "[ジャンプ] 設定・世界観フォルダー" },
          { name: "setting", desc: "[ジャンプ] 設定・世界観フォルダー" },
          { name: "root", desc: "[ジャンプ] プロジェクトルート" },
        ];

        for (const kw of semanticKeywords) {
          // 実フォルダー名と重複しない場合、かつ prefix に一致する場合に追加
          const alreadyExists = suggestions.some((s) => s.name.toLowerCase() === kw.name);
          if (!alreadyExists && (prefix === "" || kw.name.startsWith(prefix.toLowerCase()))) {
            suggestions.push({
              name: kw.name,
              path: `${kw.name}/`,
              description: kw.desc,
            });
          }
        }
      }

      // ソート（.. は最優先、次にセマンティック候補、それ以外は名前順）
      suggestions.sort((a, b) => {
        if (a.name === "..") return -1;
        if (b.name === "..") return 1;
        const aIsSemantic = a.description?.startsWith("[ジャンプ]");
        const bIsSemantic = b.description?.startsWith("[ジャンプ]");
        if (aIsSemantic && !bIsSemantic) return -1;
        if (!aIsSemantic && bIsSemantic) return 1;
        return a.name.localeCompare(b.name, "ja");
      });

      return { suggestions, prefix };
    } catch {
      return { suggestions: [], prefix };
    }
  }

  /**
   * /ruby, /proofread, /check 等のファイル入力に対する原稿ファイル補完候補を取得
   * @param rawArg 入力途中の引数（例: "" や "第1" や "10_novels/第"）
   */
  getFileSuggestions(rawArg: string = ""): FolderSuggestionResult {
    const normalized = rawArg.replace(/\\/g, "/");
    const lastSlashIndex = normalized.lastIndexOf("/");
    let searchDirRel = "";
    let prefix = normalized;

    if (lastSlashIndex >= 0) {
      searchDirRel = normalized.slice(0, lastSlashIndex);
      prefix = normalized.slice(lastSlashIndex + 1);
    }

    const searchTarget = searchDirRel ? path.resolve(this.currentDir, searchDirRel) : this.currentDir;

    if (!this.isWithinRoot(searchTarget) || !fs.existsSync(searchTarget)) {
      return { suggestions: [], prefix };
    }

    try {
      const stat = fs.statSync(searchTarget);
      if (!stat.isDirectory()) {
        return { suggestions: [], prefix };
      }

      const entries = fs.readdirSync(searchTarget, { withFileTypes: true });
      const suggestions: FolderSuggestion[] = [];

      for (const ent of entries) {
        if (ent.name.startsWith(".")) continue;
        if (prefix !== "" && !ent.name.toLowerCase().startsWith(prefix.toLowerCase())) continue;

        if (ent.isDirectory()) {
          suggestions.push({
            name: ent.name,
            path: `${ent.name}/`,
            description: "フォルダー",
          });
        } else {
          // テキスト・Markdown原稿ファイルのみ候補化
          const ext = path.extname(ent.name).toLowerCase();
          if ([".txt", ".md", ".text"].includes(ext)) {
            suggestions.push({
              name: ent.name,
              path: ent.name,
              description: ext === ".txt" ? "小説原稿" : "Markdown文書",
            });
          }
        }
      }

      suggestions.sort((a, b) => {
        const aIsDir = a.path.endsWith("/");
        const bIsDir = b.path.endsWith("/");
        if (aIsDir && !bIsDir) return 1; // ファイルを優先表示
        if (!aIsDir && bIsDir) return -1;
        return a.name.localeCompare(b.name, "ja");
      });

      return { suggestions, prefix };
    } catch {
      return { suggestions: [], prefix };
    }
  }

  /**
   * 指定されたパスがプロジェクトルート配下に収まっているかを検証
   */
  private isWithinRoot(targetPath: string): boolean {
    const rel = path.relative(this.rootDir, targetPath);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  }
}
