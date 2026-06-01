import type { RuntimeEvent } from "@ore-code/protocol";

export type PreferredLanguage = "zh" | "en" | "ja" | "ko";

const EXPLICIT_LANGUAGE_PATTERNS: Array<{ language: PreferredLanguage; pattern: RegExp }> = [
  { language: "en", pattern: /(用|使用)?\s*(英文|英语)\s*(生成|写|输出)?\s*(提交信息|commit message)|commit message\s+in\s+english|english\s+commit\s+message|write\s+.*commit\s+message\s+.*english/i },
  { language: "zh", pattern: /(用|使用)?\s*(中文|汉语)\s*(生成|写|输出)?\s*(提交信息|commit message)|commit message\s+in\s+(chinese|mandarin)|chinese\s+commit\s+message/i },
  { language: "ja", pattern: /(用|使用)?\s*(日文|日语)\s*(生成|写|输出)?\s*(提交信息|commit message)|commit message\s+in\s+japanese|japanese\s+commit\s+message/i },
  { language: "ko", pattern: /(用|使用)?\s*(韩文|韩语|朝鲜语)\s*(生成|写|输出)?\s*(提交信息|commit message)|commit message\s+in\s+korean|korean\s+commit\s+message/i }
];

export function detectPreferredLanguage(events: RuntimeEvent[], fallback: PreferredLanguage = "zh"): PreferredLanguage {
  const recentMessages = recentUserMessages(events, 8);
  for (const text of recentMessages) {
    const explicit = explicitLanguageFromText(text);
    if (explicit) {
      return explicit;
    }
  }

  const sample = recentMessages.join("\n").trim();
  if (!sample) {
    return fallback;
  }

  return dominantLanguageFromText(sample) ?? fallback;
}

function recentUserMessages(events: RuntimeEvent[], limit: number) {
  const messages: string[] = [];
  for (let index = events.length - 1; index >= 0 && messages.length < limit; index -= 1) {
    const event = events[index];
    if (event.type === "user_message" && event.text.trim()) {
      messages.push(event.text);
    }
  }
  return messages;
}

function explicitLanguageFromText(text: string): PreferredLanguage | null {
  for (const candidate of EXPLICIT_LANGUAGE_PATTERNS) {
    if (candidate.pattern.test(text)) {
      return candidate.language;
    }
  }
  return null;
}

function dominantLanguageFromText(text: string): PreferredLanguage | null {
  const counts = {
    zh: countMatches(text, /[\u4e00-\u9fff]/gu),
    ja: countMatches(text, /[\u3040-\u30ff]/gu),
    ko: countMatches(text, /[\uac00-\ud7af]/gu),
    latin: countMatches(text, /[A-Za-z]/g)
  };
  const signal = counts.zh + counts.ja + counts.ko + counts.latin;
  if (signal === 0) {
    return null;
  }

  if (counts.ja / signal >= 0.2) {
    return "ja";
  }
  if (counts.ko / signal >= 0.2) {
    return "ko";
  }
  if (counts.zh / signal >= 0.18 || counts.zh >= 4) {
    return "zh";
  }
  return "en";
}

function countMatches(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].length;
}
