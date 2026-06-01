import type { LlmClient, LlmPrefixCompletionInput, ModelUsage } from "@ore-code/agent-core";
import type { PreferredLanguage } from "./preferredLanguage";

const REVIEW_MAX_DIFF_CHARS = 20_000;

export type LightweightCompletionMode = "fim" | "chat-prefix-fallback" | "chat-fallback";

export type LightweightReviewResult = {
  text: string;
  mode: LightweightCompletionMode;
  usage?: ModelUsage;
};

export type LightweightReviewInput = {
  diff: string;
  path: string;
  threadId?: string;
  turnId?: string;
};

export type LightweightCommitMessageInput = {
  diff: string;
  language?: PreferredLanguage;
  threadId?: string;
  turnId?: string;
};

export function buildReviewPrefixCompletionInput(input: LightweightReviewInput): LlmPrefixCompletionInput {
  return {
    threadId: input.threadId ?? "lightweight-review",
    turnId: input.turnId ?? `fim-review-${Date.now()}`,
    prefix: [
      "你是代码评审助手。请基于下面单文件 diff 生成一条简短、可执行的中文 review comment。",
      "只输出评论正文；如果没有明确问题，输出“LGTM，未发现阻断问题。”",
      `File: ${input.path}`,
      "Diff:",
      trimDiffForLightweightReview(input.diff),
      "",
      "Review comment:"
    ].join("\n"),
    maxTokens: 512
  };
}

export async function generateLightweightReviewComment(
  client: LlmClient,
  input: LightweightReviewInput
): Promise<LightweightReviewResult> {
  const prefixInput = buildReviewPrefixCompletionInput(input);
  if (client.completePrefix) {
    const result = await client.completePrefix(prefixInput);
    return {
      text: normalizeLightweightReviewText(result.text),
      mode: result.mode,
      usage: result.usage
    };
  }

  const chunks = client.streamTurn({
    threadId: prefixInput.threadId,
    turnId: prefixInput.turnId,
    messages: [{ role: "user", content: prefixInput.prefix }]
  });
  let text = "";
  let usage: ModelUsage | undefined;
  for await (const chunk of chunks) {
    if (chunk.type === "assistant_delta") {
      text += chunk.text;
    }
    if (chunk.type === "usage") {
      usage = chunk.usage;
    }
  }

  return {
    text: normalizeLightweightReviewText(text),
    mode: "chat-fallback",
    usage
  };
}

export function buildCommitMessagePrefixCompletionInput(input: LightweightCommitMessageInput): LlmPrefixCompletionInput {
  const language = input.language ?? "en";
  return {
    threadId: input.threadId ?? "lightweight-commit-message",
    turnId: input.turnId ?? `fim-commit-${Date.now()}`,
    prefix: [
      commitMessageInstruction(language),
      "Return only the commit subject, no markdown, no explanation.",
      "Diff:",
      trimDiffForLightweightReview(input.diff),
      "",
      "Commit message:"
    ].join("\n"),
    maxTokens: 96
  };
}

function commitMessageInstruction(language: PreferredLanguage) {
  switch (language) {
    case "zh":
      return "生成一条简洁中文 conventional commit message。保留 type/scope 为英文，例如 `fix(ui): 修复 diff 展开滚动`。";
    case "ja":
      return "Write one concise conventional commit message with the subject in Japanese. Keep the conventional commit type/scope in English, for example `fix(ui): diff 展開のスクロールを修正`.";
    case "ko":
      return "Write one concise conventional commit message with the subject in Korean. Keep the conventional commit type/scope in English, for example `fix(ui): diff 확장 스크롤 수정`.";
    case "en":
      return "Write one concise conventional commit message in English for the following diff.";
  }
}

export async function generateLightweightCommitMessage(
  client: LlmClient,
  input: LightweightCommitMessageInput
): Promise<LightweightReviewResult> {
  const language = input.language ?? "en";
  const prefixInput = buildCommitMessagePrefixCompletionInput(input);
  if (client.completePrefix) {
    const result = await client.completePrefix(prefixInput);
    const text = firstNonEmptyLine(result.text);
    if (text) {
      return {
        text,
        mode: result.mode,
        usage: result.usage
      };
    }
  }

  const chunks = client.streamTurn({
    threadId: prefixInput.threadId,
    turnId: prefixInput.turnId,
    messages: [{ role: "user", content: prefixInput.prefix }]
  });
  let text = "";
  let usage: ModelUsage | undefined;
  for await (const chunk of chunks) {
    if (chunk.type === "assistant_delta") {
      text += chunk.text;
    }
    if (chunk.type === "usage") {
      usage = chunk.usage;
    }
  }

  return {
    text: normalizeCommitMessageText(text, language),
    mode: "chat-fallback",
    usage
  };
}

function trimDiffForLightweightReview(diff: string) {
  if (diff.length <= REVIEW_MAX_DIFF_CHARS) {
    return diff;
  }

  const omitted = diff.length - REVIEW_MAX_DIFF_CHARS;
  return `${diff.slice(0, REVIEW_MAX_DIFF_CHARS)}\n[diff truncated ${omitted} chars for lightweight review]`;
}

function normalizeLightweightReviewText(text: string) {
  return text.trim() || "LGTM，未发现阻断问题。";
}

function normalizeCommitMessageText(text: string, language: PreferredLanguage) {
  const normalized = firstNonEmptyLine(text);
  if (normalized) {
    return normalized;
  }

  switch (language) {
    case "zh":
      return "chore: 更新代码变更";
    case "ja":
      return "chore: コード変更を更新";
    case "ko":
      return "chore: 코드 변경 업데이트";
    case "en":
      return "chore: update code changes";
  }
}

function firstNonEmptyLine(text: string) {
  return text.trim()
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/```$/i, "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
}
