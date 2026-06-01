import { parseRuntimeEvent, type RuntimeEvent } from "@ore-code/protocol";

export interface ReplaySnapshot {
  events: RuntimeEvent[];
  assistantText: string;
  completed: boolean;
}

export function replayEvents(rawEvents: unknown[]): ReplaySnapshot {
  const events = rawEvents.map(parseRuntimeEvent).sort((a, b) => a.seq - b.seq);
  return {
    events,
    assistantText: events
      .filter((event) => event.type === "assistant_delta" || event.type === "assistant_message")
      .map((event) => event.text)
      .join(""),
    completed: events.some((event) => event.type === "turn_completed")
  };
}

