import { DocumentMetadata } from './types.js';

/**
 * テキストから YAML Front Matter メタデータと本文を抽出
 */
export function parseFrontmatter(content: string): {
  metadata: DocumentMetadata;
  body: string;
} {
  if (!content.startsWith('---')) {
    return { metadata: {}, body: content };
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, body: content };
  }

  const yamlBlock = match[1];
  const body = match[2];
  const metadata: DocumentMetadata = {};

  const lines = yamlBlock.split(/\r?\n/);
  let currentKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // リストアイテム (- item)
    if (trimmed.startsWith('-') && currentKey) {
      const itemVal = trimmed.replace(/^-\s*/, '').trim().replace(/^["']|["']$/g, '');
      if (itemVal) {
        if (!Array.isArray(metadata[currentKey])) {
          metadata[currentKey] = [];
        }
        (metadata[currentKey] as string[]).push(itemVal);
      }
      continue;
    }

    // キー: 値
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const rawVal = line.slice(colonIndex + 1).trim();
      currentKey = key;

      if (rawVal === '') {
        // 次行以降にリストが続く可能性
        metadata[key] = [];
      } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        // インライン配列 [a, b, c]
        const items = rawVal
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
        metadata[key] = items;
      } else {
        // 通常の文字列・数値
        const cleanVal = rawVal.replace(/^["']|["']$/g, '');
        metadata[key] = cleanVal;
      }
    }
  }

  // tags の正規化（文字列なら配列に変換）
  if (typeof metadata.tags === 'string') {
    metadata.tags = [metadata.tags];
  }

  return { metadata, body };
}
