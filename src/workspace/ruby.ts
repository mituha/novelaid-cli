/**
 * novelaid-cli ルビ処理モジュール
 * novelaid-ruby (https://github.com/mituha/novelaid-ruby-ts) 準拠
 */

/**
 * ルビおよび傍点に関する正規表現パターン
 */
export const RUBY_PATTERNS = {
  /**
   * ルビ記法 (パイプあり): `|親文字《ルビ》` または `｜親文字《ルビ》`
   * 全角・半角パイプ対応
   */
  RUBY_WITH_PIPE: /[|｜]([^|｜\n《》]+)《([^《》\n]+)》/g,

  /**
   * ルビ記法 (パイプなし漢字ルビ): `漢字《ルビ》`
   */
  RUBY_WITHOUT_PIPE: /([々〇\u4e00-\u9fcf\u3400-\u4dbf]+)《([^《》\n]+)》/g,

  /**
   * 傍点（圏点）: `《《強調》》`
   */
  BOUTEN: /《《([^《》\n]+)》》/g,
};

/**
 * ルビフォーマットの種類
 */
export type RubyFormat = "pipe" | "kanji" | "html";

/**
 * テキストからルビ記法・傍点をすべて除去し、プレーンテキストを返す
 */
export function stripRuby(text: string): string {
  if (!text) return "";
  let processed = text;
  processed = processed.replace(RUBY_PATTERNS.RUBY_WITH_PIPE, "$1");
  processed = processed.replace(RUBY_PATTERNS.RUBY_WITHOUT_PIPE, "$1");
  processed = processed.replace(RUBY_PATTERNS.BOUTEN, "$1");
  return processed;
}

/**
 * テキスト内のすべてのルビ（読み）部分を抽出して配列で返す
 */
export function extractRubyList(text: string): Array<{ parent: string; ruby: string }> {
  if (!text) return [];
  const list: Array<{ parent: string; ruby: string }> = [];

  // パイプありを優先探索
  let remaining = text;
  remaining = remaining.replace(RUBY_PATTERNS.RUBY_WITH_PIPE, (_, p1, p2) => {
    list.push({ parent: p1, ruby: p2 });
    return " ".repeat(p1.length);
  });

  remaining.replace(RUBY_PATTERNS.RUBY_WITHOUT_PIPE, (_, p1, p2) => {
    list.push({ parent: p1, ruby: p2 });
    return " ".repeat(p1.length);
  });

  return list;
}

/**
 * 親文字とルビからパイプ付きルビ文字列（|親文字《ルビ》）を生成
 */
export function formatRuby(parent: string, ruby: string): string {
  return `|${parent}《${ruby}》`;
}

/**
 * テキスト内の指定された単語（初出箇所）にルビを適用する
 * すでにルビが振られている箇所はスキップする
 */
export function applyRubyToFirstOccurrence(
  content: string,
  parent: string,
  ruby: string
): { success: boolean; newContent: string } {
  if (!content || !parent || !ruby) {
    return { success: false, newContent: content };
  }

  // すでにルビが振られているかチェック
  const existingRubies = extractRubyList(content);
  if (existingRubies.some((r) => r.parent === parent)) {
    return { success: false, newContent: content };
  }

  const rubyString = formatRuby(parent, ruby);

  // パイプや《》の内部にない単純な単語出現箇所を探索
  const index = content.indexOf(parent);
  if (index === -1) {
    return { success: false, newContent: content };
  }

  // 前後の文字がパイプや《》でないか確認（簡易ガード）
  const charBefore = index > 0 ? content[index - 1] : "";
  const charAfter = index + parent.length < content.length ? content[index + parent.length] : "";
  if (charBefore === "|" || charBefore === "｜" || charAfter === "《") {
    return { success: false, newContent: content };
  }

  const newContent = content.slice(0, index) + rubyString + content.slice(index + parent.length);
  return { success: true, newContent };
}
