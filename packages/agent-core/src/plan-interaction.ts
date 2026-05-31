import { z } from "zod";
import type { InteractionOption } from "@seekforge/protocol";

export type ParsedInteractionRequest = {
  requestId?: string;
  title: string;
  message: string;
  options: InteractionOption[];
  recommendedOptionId?: string;
};

const InteractionRequestSchema = z.object({
  type: z.literal("interaction_request").optional(),
  kind: z.literal("choice").optional(),
  requestId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  message: z.string().trim().min(1),
  options: z.array(z.object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    value: z.string().optional()
  })).min(1),
  recommendedOptionId: z.string().trim().min(1).optional()
});

const INTERACTION_REQUEST_PATTERN = /<interaction_request>\s*([\s\S]*?)\s*<\/interaction_request>/i;
const CONFIRMATION_TEXT_PATTERN = /(确认|选择|请选择|告诉我|偏好|补充|clarif|choose|confirm|preference)/i;
const SINGLE_PLAN_CONFIRMATION_PATTERN = /(要开始吗|开始吗|确认后.*开始|确认后.*创建|立即开始|开始创建)/;
const QUESTION_LINE_PATTERN = /[?？]/;
const OPTION_PREFIX_PATTERN = /^(?:[-*•]\s+|\d+[.)、]\s*)/;
const MARKDOWN_FIELD_PATTERN = /^\*\*[^*]+?\*\*[：:]/;
const MAX_OPTION_LABEL_LENGTH = 80;
const MAX_STRUCTURED_OPTIONS = 3;
const MAX_STRUCTURED_MESSAGE_LENGTH = 120;
const MAX_STRUCTURED_OPTION_LABEL_LENGTH = 48;

export function parsePlanInteractionRequest(text: string): ParsedInteractionRequest | null {
  const match = text.match(INTERACTION_REQUEST_PATTERN);
  if (!match) {
    return parsePlainTextInteractionRequest(text);
  }

  try {
    const parsed = InteractionRequestSchema.parse(JSON.parse(match[1]));
    const optionIds = new Set(parsed.options.map((option) => option.id));
    return normalizeParsedInteraction({
      requestId: parsed.requestId,
      title: parsed.title,
      message: parsed.message,
      options: parsed.options,
      recommendedOptionId:
        parsed.recommendedOptionId && optionIds.has(parsed.recommendedOptionId)
          ? parsed.recommendedOptionId
          : undefined
    });
  } catch {
    return null;
  }
}

function parsePlainTextInteractionRequest(text: string): ParsedInteractionRequest | null {
  const trimmed = sanitizePlainInteractionText(text);
  if (!trimmed || !CONFIRMATION_TEXT_PATTERN.test(trimmed)) {
    return null;
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.some((line) => QUESTION_LINE_PATTERN.test(line))) {
    return null;
  }

  const singlePlanConfirmation = SINGLE_PLAN_CONFIRMATION_PATTERN.test(trimmed);
  const question = singlePlanConfirmation ? "要按上面的方案开始吗？" : firstQuestionLine(lines);
  const extractedOptions = singlePlanConfirmation
    ? []
    : extractFirstChoiceGroup(lines);
  const options: InteractionOption[] = extractedOptions.length >= 2
    ? extractedOptions.map((label, index) => ({
      id: `option-${index + 1}`,
      label
    }))
    : [{
      id: "use-recommended-default",
      label: singlePlanConfirmation ? "开始执行" : "按推荐默认方案继续",
      description: singlePlanConfirmation
        ? "使用上面的方案继续当前计划。"
        : "让模型基于现有上下文选择合理默认值继续。"
    }];

  return {
    title: singlePlanConfirmation ? "确认方案" : titleFromQuestion(question),
    message: question,
    options,
    recommendedOptionId: options.length === 1 ? options[0].id : undefined
  };
}

function normalizeParsedInteraction(interaction: ParsedInteractionRequest): ParsedInteractionRequest {
  const options = interaction.options.slice(0, MAX_STRUCTURED_OPTIONS).map((option) => {
    const description = option.description ? compactText(option.description, MAX_STRUCTURED_MESSAGE_LENGTH) : undefined;
    return {
      id: option.id,
      label: compactText(option.label, MAX_STRUCTURED_OPTION_LABEL_LENGTH),
      ...(description ? { description } : {}),
      ...(option.value !== undefined ? { value: option.value } : {})
    };
  });
  const optionIds = new Set(options.map((option) => option.id));

  return {
    ...interaction,
    title: compactText(stripTrailingPunctuation(interaction.title), 16) || "需要确认",
    message: compactMessage(interaction.message),
    options,
    recommendedOptionId:
      interaction.recommendedOptionId && optionIds.has(interaction.recommendedOptionId)
        ? interaction.recommendedOptionId
        : undefined
  };
}

function compactMessage(message: string) {
  const sanitized = sanitizePlainInteractionText(message);
  const question = findQuestionLine(sanitized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  return compactText(question || sanitized, MAX_STRUCTURED_MESSAGE_LENGTH);
}

function extractFirstChoiceGroup(lines: string[]): string[] {
  let collecting = false;
  const options: string[] = [];

  for (const line of lines) {
    const normalized = normalizeOptionLine(line);
    const looksLikeQuestion = QUESTION_LINE_PATTERN.test(line);
    const looksLikeHeading = /[：:]$/.test(line) || /[：:].*[?？]/.test(line);

    if (!collecting) {
      if (looksLikeQuestion || looksLikeHeading) {
        collecting = true;
      }
      continue;
    }

    if ((looksLikeQuestion || looksLikeHeading) && options.length > 0) {
      break;
    }

    if (isCandidateOption(normalized)) {
      options.push(normalized);
    }
  }

  return dedupe(options).slice(0, 5);
}

function normalizeOptionLine(line: string) {
  return sanitizePlainInteractionText(line.replace(OPTION_PREFIX_PATTERN, ""));
}

function firstQuestionLine(lines: string[]) {
  const questionLine = findQuestionLine(lines);
  if (questionLine) {
    return questionLine;
  }

  const headingLine = lines.find((line) => /[：:]$/.test(line));
  return headingLine ? compactText(headingLine, MAX_STRUCTURED_MESSAGE_LENGTH) : "请确认后继续。";
}

function findQuestionLine(lines: string[]) {
  const questionLine = lines.find((line) => QUESTION_LINE_PATTERN.test(line));
  return questionLine ? compactText(questionLine, MAX_STRUCTURED_MESSAGE_LENGTH) : "";
}

function titleFromQuestion(question: string) {
  const prefix = question.split(/[：:]/)[0]?.trim();
  if (prefix && prefix.length <= 12 && prefix !== question) {
    return stripTrailingPunctuation(prefix);
  }

  return "需要确认";
}

function isCandidateOption(line: string) {
  if (!line || line.length > MAX_OPTION_LABEL_LENGTH) {
    return false;
  }
  if (QUESTION_LINE_PATTERN.test(line) || /[：:]$/.test(line)) {
    return false;
  }
  if (MARKDOWN_FIELD_PATTERN.test(line)) {
    return false;
  }
  return true;
}

function dedupe(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function sanitizePlainInteractionText(text: string) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function compactText(text: string, maxLength: number) {
  const compacted = sanitizePlainInteractionText(text).replace(/\s+/g, " ").trim();
  return compacted.length > maxLength ? `${compacted.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` : compacted;
}

function stripTrailingPunctuation(text: string) {
  return text.replace(/[?？:：。,.，、\s]+$/g, "").trim();
}
