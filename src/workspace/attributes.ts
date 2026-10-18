import fs from 'node:fs';
import path from 'node:path';

/**
 * ワイルドカードパターンが対象の文字列にマッチするか判定
 * - 完全一致判定
 * - * (任意の0文字以上)
 * - ? (任意の1文字)
 * - 大文字小文字不問 (case-insensitive)
 */
export function patternMatches(pattern: string, target: string): boolean {
  if (pattern === target) return true;
  if (!pattern.includes('*') && !pattern.includes('?')) {
    return pattern.toLowerCase() === target.toLowerCase();
  }

  // * ? 以外の正規表現特殊文字をエスケープ
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexStr}$`, 'i');
  return regex.test(target);
}

/**
 * .novelaidattributes 管理クラス
 * 各ディレクトリ直下に配置された .novelaidattributes を読み込み、キャッシュします。
 * （非再帰の原則：影響範囲は同一ディレクトリ内のファイルおよび直下フォルダーのみ）
 */
export class NovelaidAttributesManager {
  private cache = new Map<string, { mtime: number; data: Map<string, string> }>();

  /**
   * 指定ディレクトリのキャッシュを破棄（未指定時は全キャッシュクリア）
   */
  invalidateCache(dirPath?: string): void {
    if (dirPath) {
      this.cache.delete(path.resolve(dirPath));
    } else {
      this.cache.clear();
    }
  }

  /**
   * 指定ディレクトリの .novelaidattributes を読み込み、マップを返します。
   * ファイルが存在しないか不正な場合は null を返します。
   */
  getAttributesForDirectory(dirPath: string): Map<string, string> | null {
    const resolvedDir = path.resolve(dirPath);
    const attrPath = path.join(resolvedDir, '.novelaidattributes');

    try {
      if (!fs.existsSync(attrPath)) {
        return null;
      }

      const stat = fs.statSync(attrPath);
      const cached = this.cache.get(resolvedDir);
      if (cached && cached.mtime === stat.mtimeMs) {
        return cached.data;
      }

      const content = fs.readFileSync(attrPath, 'utf-8');
      const data = new Map<string, string>();
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // 空行および # で始まるコメント行は無視
        if (!trimmed || trimmed.startsWith('#')) continue;

        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          const pattern = parts[0];
          const type = parts[1];
          data.set(pattern, type);
        }
      }

      this.cache.set(resolvedDir, { mtime: stat.mtimeMs, data });
      return data;
    } catch {
      return null;
    }
  }

  /**
   * ディレクトリ内のファイル名に対してマッチする属性値（ドキュメントタイプ）を解決
   */
  resolveFileType(dirPath: string, fileName: string): string | null {
    const attrs = this.getAttributesForDirectory(dirPath);
    if (!attrs) return null;

    for (const [pattern, type] of attrs.entries()) {
      // ディレクトリ用パターン（末尾 /）および ./ はファイルには適用しない
      if (!pattern.endsWith('/') && pattern !== './' && patternMatches(pattern, fileName)) {
        return type;
      }
    }

    return null;
  }

  /**
   * ディレクトリ自身（./）または親ディレクトリから指定されたディレクトリ属性値を解決
   */
  resolveDirectoryType(dirPath: string): string | null {
    const resolvedDir = path.resolve(dirPath);

    // 1. 自分自身の .novelaidattributes 内の `./` 指定を確認
    const ownAttrs = this.getAttributesForDirectory(resolvedDir);
    if (ownAttrs?.has('./')) {
      return ownAttrs.get('./')!;
    }

    // 2. 親ディレクトリの .novelaidattributes 内の `フォルダー名/` パターンを確認
    const parentDir = path.dirname(resolvedDir);
    if (parentDir !== resolvedDir) {
      const parentAttrs = this.getAttributesForDirectory(parentDir);
      if (parentAttrs) {
        const dirKeyword = `${path.basename(resolvedDir)}/`;
        for (const [pattern, type] of parentAttrs.entries()) {
          if (pattern.endsWith('/') && patternMatches(pattern, dirKeyword)) {
            return type;
          }
        }
      }
    }

    return null;
  }
}
