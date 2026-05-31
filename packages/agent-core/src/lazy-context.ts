import type { RuntimeEvent } from "@seekforge/protocol";
import { estimateTokensFromChars } from "./capacity";

export type LazyContextEvent = Extract<RuntimeEvent, { type: "lazy_context_loaded" }>;
export type LazyContextEventBody = Omit<LazyContextEvent, "id" | "seq" | "threadId" | "turnId" | "createdAt">;

const MAX_MODEL_CONTEXT_CHARS = 24_000;

export function createLazyContextEventBody(input: {
  source: LazyContextEvent["source"];
  sourceId: string;
  title: string;
  summary: string;
  content?: string;
}): LazyContextEventBody {
  const content = input.content ? truncateLazyContextContent(input.content) : undefined;
  const contentChars = content?.length ?? 0;
  return {
    type: "lazy_context_loaded",
    source: input.source,
    sourceId: input.sourceId,
    title: input.title,
    summary: input.summary,
    ...(content ? { content } : {}),
    contentChars,
    tokenEstimate: estimateTokensFromChars(contentChars)
  };
}

export function formatLazyContextForModel(event: LazyContextEvent): string {
  const header = [
    `[lazy_context:${event.source}:${event.sourceId}]`,
    `Title: ${event.title}`,
    `Summary: ${event.summary}`,
    `Chars: ${event.contentChars}`
  ].join("\n");

  if (!event.content) {
    return `${header}\nContent: loaded by tool result or UI preview; no model injection payload was attached.`;
  }

  return [
    header,
    "Content:",
    "```",
    event.content,
    "```"
  ].join("\n");
}

function truncateLazyContextContent(content: string) {
  const normalized = content.trim();
  if (normalized.length <= MAX_MODEL_CONTEXT_CHARS) {
    return normalized;
  }
  const suffix = `\n[truncated ${normalized.length - MAX_MODEL_CONTEXT_CHARS} chars from lazy context]`;
  return `${normalized.slice(0, Math.max(0, MAX_MODEL_CONTEXT_CHARS - suffix.length))}${suffix}`;
}
