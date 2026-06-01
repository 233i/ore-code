import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@ore-code/protocol";
import { eventsFromJsonl, eventsToJsonl, summarizeSession } from "./jsonl-session-store";

describe("jsonl session store", () => {
  it("round-trips runtime events through JSONL", () => {
    const events = [userMessage("thread-a", "turn-a", "run pnpm test"), turnCompleted("thread-a", "turn-a")];

    const parsed = eventsFromJsonl(eventsToJsonl(events));

    expect(parsed).toEqual(events);
  });

  it("rejects invalid event lines when loading JSONL", () => {
    expect(() => eventsFromJsonl('{"type":"unknown"}\n')).toThrow();
  });

  it("summarizes title, count, and updated timestamp", () => {
    const events = [userMessage("thread-a", "turn-a", "  read   README  "), turnCompleted("thread-a", "turn-a")];

    expect(summarizeSession("thread-a", events)).toEqual({
      threadId: "thread-a",
      title: "read README",
      eventCount: 2,
      updatedAt: "2026-05-09T00:00:01.000Z"
    });
  });
});

function userMessage(threadId: string, turnId: string, text: string): RuntimeEvent {
  return {
    id: `${turnId}-user`,
    seq: 0,
    threadId,
    turnId,
    createdAt: "2026-05-09T00:00:00.000Z",
    type: "user_message",
    text
  };
}

function turnCompleted(threadId: string, turnId: string): RuntimeEvent {
  return {
    id: `${turnId}-done`,
    seq: 1,
    threadId,
    turnId,
    createdAt: "2026-05-09T00:00:01.000Z",
    type: "turn_completed"
  };
}
