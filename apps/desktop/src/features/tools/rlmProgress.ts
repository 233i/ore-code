import type { ToolCardState } from "./toolCards";

export type RlmProgress = {
  total: number;
  running: number;
  completed: number;
  failed: number;
  items: Array<{
    index: number;
    status: "running" | "completed" | "failed";
    promptPreview: string;
    durationMs?: number;
    error?: string;
  }>;
};

export function deriveRlmProgressForToolCard(card: ToolCardState): RlmProgress | null {
  if (card.name !== "rlm_query") {
    return null;
  }

  const byIndex = new Map<number, RlmProgress["items"][number]>();
  let total = inputPromptCount(card.input);

  for (const event of parseRlmProgressEvents(card.commandOutput?.stdout ?? "")) {
    total = Math.max(total, event.total);
    byIndex.set(event.index, {
      index: event.index,
      status: event.status,
      promptPreview: event.promptPreview,
      durationMs: event.durationMs,
      error: event.error
    });
  }

  const output = card.result?.output as Record<string, unknown> | undefined;
  if (typeof output?.promptCount === "number") {
    total = Math.max(total, output.promptCount);
  }

  const results = Array.isArray(output?.results) ? output.results : [];
  for (const result of results) {
    if (!result || typeof result !== "object") {
      continue;
    }
    const record = result as Record<string, unknown>;
    if (typeof record.index !== "number") {
      continue;
    }
    byIndex.set(record.index, {
      index: record.index,
      status: record.ok === false ? "failed" : "completed",
      promptPreview: typeof record.promptPreview === "string" ? record.promptPreview : `subtask ${record.index + 1}`,
      durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
      error: typeof record.error === "string" ? record.error : undefined
    });
  }

  if (total === 0 && byIndex.size === 0) {
    return null;
  }

  const items = Array.from({ length: Math.max(total, byIndex.size) }, (_, index) =>
    byIndex.get(index) ?? {
      index,
      status: "running" as const,
      promptPreview: `subtask ${index + 1}`
    }
  );
  const completed = items.filter((item) => item.status === "completed").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const running = items.length - completed - failed;

  return {
    total: items.length,
    running,
    completed,
    failed,
    items
  };
}

function parseRlmProgressEvents(stdout: string) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter(isRlmProgressEvent);
}

function isRlmProgressEvent(value: unknown): value is {
  type: "rlm_progress";
  status: "running" | "completed" | "failed";
  index: number;
  total: number;
  promptPreview: string;
  durationMs?: number;
  error?: string;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.type === "rlm_progress" &&
    (record.status === "running" || record.status === "completed" || record.status === "failed") &&
    typeof record.index === "number" &&
    typeof record.total === "number" &&
    typeof record.promptPreview === "string";
}

function inputPromptCount(input: unknown) {
  if (!input || typeof input !== "object") {
    return 0;
  }

  const record = input as Record<string, unknown>;
  if (Array.isArray(record.prompts)) {
    return record.prompts.length;
  }
  return typeof record.prompt === "string" ? 1 : 0;
}
