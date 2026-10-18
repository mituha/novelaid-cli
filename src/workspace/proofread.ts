/**
 * novelaid-cli 小説校正・推敲支援モジュール
 * 誤字脱字、表記揺れ、慣用句の誤用、文末重複（リズム崩れ）のクイックスキャン
 */

export interface ProofreadIssue {
  line: number;
  type: "typo" | "repetition" | "idiom" | "redundancy";
  original: string;
  suggestion?: string;
  message: string;
}

/** よくある誤字・誤用・表記揺れの辞書パターン */
const COMMON_PATTERNS: Array<{
  pattern: RegExp;
  type: ProofreadIssue["type"];
  suggestion: string;
  message: string;
}> = [
  {
    pattern: /ふいんき/g,
    type: "typo",
    suggestion: "雰囲気（ふんいき）",
    message: "「ふいんき」は誤記です。「雰囲気（ふんいき）」の可能性があります。",
  },
  {
    pattern: /的を得/g,
    type: "idiom",
    suggestion: "的を射",
    message: "「的を得る」は誤用とされることが多い表現です。「的を射る」または「要領を得る」が推奨されます。",
  },
  {
    pattern: /足元をすくわれ/g,
    type: "idiom",
    suggestion: "足をすくわれ",
    message: "「足元をすくわれる」は誤用とされる表現です。「足をすくわれる」が適切です。",
  },
  {
    pattern: /思わぬハプニング/g,
    type: "redundancy",
    suggestion: "ハプニング / 思いがけない出来事",
    message: "ハプニング自体に「思いがけない出来事」の意味が含まれるため重複表現（重言）です。",
  },
  {
    pattern: /一番最後/g,
    type: "redundancy",
    suggestion: "最後",
    message: "重複表現（重言）です。「最後」で十分に意味が通じます。",
  },
  {
    pattern: /こと(?:が|は)できる/g,
    type: "redundancy",
    suggestion: "動詞可能形",
    message: "「〜することができる」は冗長になりがちです。可能動詞（例: 「読める」）への簡潔化を検討してください。",
  },
];

/**
 * 原稿テキストを行ごとに解析し、誤字脱字・表記揺れ・文末重複をスキャン
 */
export function scanProofreadIssues(text: string): ProofreadIssue[] {
  const issues: ProofreadIssue[] = [];
  const lines = text.split(/\r?\n/);

  let consecutiveTaEndingCount = 0;
  let repetitionStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const rawLine = lines[i] ?? "";
    const line = rawLine.trim();

    if (!line || line.startsWith("#") || line.startsWith("/*") || line.startsWith("//")) {
      // 空行や見出しは文末連続カウントをリセット
      consecutiveTaEndingCount = 0;
      continue;
    }

    // 1. 辞書ベースの誤用・誤字・冗長表現スキャン
    for (const rule of COMMON_PATTERNS) {
      const matches = rawLine.matchAll(rule.pattern);
      for (const m of matches) {
        issues.push({
          line: lineNumber,
          type: rule.type,
          original: m[0],
          suggestion: rule.suggestion,
          message: rule.message,
        });
      }
    }

    // 2. 文末重複チェック（地の文で「〜た。」「〜だ。」が3連続以上続くケース）
    // セリフ（「…」）は除外
    const isDialogue = line.startsWith("「") || line.endsWith("」");
    if (!isDialogue) {
      const matchTa = line.match(/(?:[た|だ|った|いだ|んだ|した])。$/);
      if (matchTa) {
        if (consecutiveTaEndingCount === 0) {
          repetitionStartLine = lineNumber;
        }
        consecutiveTaEndingCount++;
        if (consecutiveTaEndingCount === 3) {
          issues.push({
            line: repetitionStartLine,
            type: "repetition",
            original: `（${repetitionStartLine}行目〜${lineNumber}行目）`,
            message: `過去形（〜た。／〜だ。）の文末が3連続以上続いています。文章のリズムや語尾の多様性を検討してください。`,
          });
        }
      } else {
        consecutiveTaEndingCount = 0;
      }
    } else {
      consecutiveTaEndingCount = 0;
    }
  }

  return issues;
}

/**
 * スキャン結果を人間およびAI向けに分かりやすくフォーマット
 */
export function formatProofreadSummary(fileName: string, issues: ProofreadIssue[]): string {
  if (issues.length === 0) {
    return `【校正チェック結果: ${fileName}】\n✔ 検出された明らかな誤字脱字・文末重複はありませんでした。`;
  }

  const lines: string[] = [
    `【校正チェック結果: ${fileName}】`,
    `⚠️ ${issues.length} 件の改善提案・注意箇所が検出されました:`,
  ];

  for (const issue of issues) {
    const typeLabel =
      issue.type === "typo"
        ? "【誤記】"
        : issue.type === "idiom"
        ? "【慣用句】"
        : issue.type === "repetition"
        ? "【文末重複】"
        : "【冗長】";

    const suggestionText = issue.suggestion ? ` ➔ 推奨: ${issue.suggestion}` : "";
    lines.push(`- L${issue.line} ${typeLabel} 「${issue.original}」${suggestionText}`);
    lines.push(`  └ ${issue.message}`);
  }

  return lines.join("\n");
}
