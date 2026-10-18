/**
 * novelaid ドキュメントタイプ定義
 * DOM標準の DocumentType との衝突を避けるため NovelaidDocumentType と命名
 */
export type NovelaidDocumentType =
  | 'novel'     // 小説本文・原稿（.txt、または .novelaidattributes で指定された .md）
  | 'markdown'  // 設定・プロット・資料等の汎用マークダウン（.md）
  | 'chat'      // チャットチャンネル（.ch）
  | 'image'     // 画像ファイル（.png, .jpg, .jpeg, .gif, .webp, .svg）
  | 'css'       // スタイルシート（.css）
  | 'gitDiff'   // Git差分
  | 'browser'   // ブラウザ表示
  | 'unknown';  // 未知・その他

/**
 * YAML Front Matter メタデータ構造
 */
export interface DocumentMetadata {
  name?: string;
  tags?: string[];
  description?: string;
  [key: string]: unknown;
}
