import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@ore-code/protocol";
import {
  buildTranscriptChunkBundle,
  derivePersistedTranscriptItems,
  transcriptItemsFromRecentEvents,
  transcriptItemsFromTail
} from "./transcriptChunks";

describe("transcript chunks", () => {
  it("derives lightweight transcript items without raw tool payloads", () => {
    const events = [
      event("user_message", { id: "u1", text: "读取文件" }),
      event("tool_call_requested", {
        id: "tc1",
        call: { id: "read-1", name: "read_file", input: { path: "/repo/src/App.tsx" } }
      }),
      event("tool_completed", {
        id: "td1",
        result: { callId: "read-1", ok: true, output: { content: "very large content", path: "/repo/src/App.tsx" } }
      }),
      event("assistant_message", { id: "a1", text: "读完了。" })
    ] satisfies RuntimeEvent[];

    const items = derivePersistedTranscriptItems(events);

    expect(items.map((item) => item.type)).toEqual(["message", "tool_summary", "message"]);
    expect(items[1]).toMatchObject({
      type: "tool_summary",
      name: "read_file",
      status: "completed"
    });
    expect(JSON.stringify(items)).not.toContain("very large content");
  });

  it("loads transcript chunks without exposing a history gap", () => {
    const events = Array.from({ length: 5 }, (_, index) => [
      event("user_message", { id: `u${index}`, text: `user ${index}` }),
      event("assistant_message", { id: `a${index}`, text: `assistant ${index}` })
    ]).flat();

    const bundle = buildTranscriptChunkBundle("thread-1", events, { chunkSize: 4 });
    const chunk = bundle.chunks[bundle.chunks.length - 1] ?? null;
    const tailItems = transcriptItemsFromTail({
      chunk,
      hiddenItemCount: bundle.totalItemCount - (chunk?.itemCount ?? 0),
      totalItemCount: bundle.totalItemCount
    });

    expect(bundle.chunks).toHaveLength(3);
    expect(tailItems.map((item) => item.id)).toEqual(["message:u4", "message:a4"]);
  });

  it("derives the visible transcript from all available events", () => {
    const events = Array.from({ length: 6 }, (_, index) => [
      event("user_message", { id: `u${index}`, text: `user ${index}` }),
      event("assistant_message", { id: `a${index}`, text: `assistant ${index}` })
    ]).flat();

    const tailItems = transcriptItemsFromRecentEvents(events);

    expect(tailItems.map((item) => item.id)).toEqual([
      "message:u0",
      "message:a0",
      "message:u1",
      "message:a1",
      "message:u2",
      "message:a2",
      "message:u3",
      "message:a3",
      "message:u4",
      "message:a4",
      "message:u5",
      "message:a5"
    ]);
  });
});

function event<T extends RuntimeEvent["type"]>(
  type: T,
  fields: Omit<Extract<RuntimeEvent, { type: T }>, "type" | "seq" | "threadId" | "turnId" | "createdAt">
): Extract<RuntimeEvent, { type: T }> {
  return {
    ...fields,
    type,
    seq: 0,
    threadId: "thread-1",
    turnId: "turn-1",
    createdAt: "2026-05-12T00:00:00.000Z"
  } as Extract<RuntimeEvent, { type: T }>;
}
