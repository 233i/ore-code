import { parseRuntimeEvent, type RuntimeEvent } from "@seekforge/protocol";

export interface SessionSummary {
  threadId: string;
  title: string;
  eventCount: number;
  updatedAt: string;
  workspacePath?: string;
}

const DEFAULT_TITLE = "Untitled session";
const TITLE_LIMIT = 80;

export function eventsToJsonl(events: RuntimeEvent[]): string {
  if (events.length === 0) {
    return "";
  }

  return `${events.map((event) => JSON.stringify(parseRuntimeEvent(event))).join("\n")}\n`;
}

export function eventsFromJsonl(jsonl: string): RuntimeEvent[] {
  return jsonl
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => parseRuntimeEvent(JSON.parse(line)));
}

export function summarizeSession(threadId: string, events: RuntimeEvent[]): SessionSummary {
  const firstUserMessage = events.find((event) => event.type === "user_message");
  const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;
  const title =
    firstUserMessage?.type === "user_message"
      ? truncateTitle(firstUserMessage.text)
      : DEFAULT_TITLE;

  return {
    threadId,
    title,
    eventCount: events.length,
    updatedAt: lastEvent?.createdAt ?? new Date(0).toISOString()
  };
}

function truncateTitle(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return DEFAULT_TITLE;
  }

  if (normalized.length <= TITLE_LIMIT) {
    return normalized;
  }

  return `${normalized.slice(0, TITLE_LIMIT - 3)}...`;
}
