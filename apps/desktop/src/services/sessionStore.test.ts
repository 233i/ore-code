import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "@seekforge/protocol";
import { listSessions, loadSessionTranscriptChunk, loadSessionTranscriptTail, renameSession, saveSessionEvents } from "./sessionStore";

describe("sessionStore browser fallback", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createMemoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renames a session without promoting it to the top of the list", async () => {
    await saveSessionEvents("thread-old", [
      userMessage("thread-old", "turn-old", "old title", "2026-05-09T00:00:00.000Z"),
      done("thread-old", "turn-old", "2026-05-09T00:00:01.000Z")
    ]);
    await saveSessionEvents("thread-new", [
      userMessage("thread-new", "turn-new", "new title", "2026-05-09T00:00:02.000Z"),
      done("thread-new", "turn-new", "2026-05-09T00:00:03.000Z")
    ]);

    expect((await listSessions()).map((summary) => summary.threadId)).toEqual(["thread-new", "thread-old"]);

    await renameSession("thread-old", "renamed old");

    expect((await listSessions()).map((summary) => `${summary.threadId}:${summary.title}`)).toEqual([
      "thread-new:new title",
      "thread-old:renamed old"
    ]);
  });

  it("persists the workspace path with the session summary", async () => {
    await saveSessionEvents("thread-workspace", [
      userMessage("thread-workspace", "turn-workspace", "read files", "2026-05-09T00:00:00.000Z"),
      done("thread-workspace", "turn-workspace", "2026-05-09T00:00:01.000Z")
    ], "/Users/lijiahao/Public/project/PureSFTP");

    await expect(listSessions()).resolves.toMatchObject([
      {
        threadId: "thread-workspace",
        workspacePath: "/Users/lijiahao/Public/project/PureSFTP"
      }
    ]);
  });

  it("persists and loads the latest lightweight transcript chunk", async () => {
    await saveSessionEvents(
      "thread-transcript",
      Array.from({ length: 41 }, (_, index) => [
        userMessage("thread-transcript", `turn-${index}`, `read files ${index}`, `2026-05-09T00:00:${String(index).padStart(2, "0")}.000Z`),
        assistantMessage("thread-transcript", `turn-${index}`, `done ${index}`, `2026-05-09T00:01:${String(index).padStart(2, "0")}.000Z`)
      ]).flat()
    );

    const tail = await loadSessionTranscriptTail("thread-transcript");
    const earlier = await loadSessionTranscriptChunk("thread-transcript", 0);

    expect(tail?.chunk?.index).toBe(1);
    expect(tail?.hiddenItemCount).toBe(80);
    expect(tail?.previousChunkIndex).toBe(0);
    expect(tail?.chunk?.items[0]).toMatchObject({ type: "message", message: { text: "read files 40" } });
    expect(earlier?.chunk?.index).toBe(0);
    expect(earlier?.hiddenItemCount).toBe(0);
    expect(earlier?.chunk?.items[0]).toMatchObject({ type: "message", message: { text: "read files 0" } });
  });

  it("can skip transcript rebuilds for high-frequency runtime saves", async () => {
    await saveSessionEvents("thread-silent", [
      userMessage("thread-silent", "turn-old", "old visible transcript", "2026-05-09T00:00:00.000Z"),
      assistantMessage("thread-silent", "turn-old", "old answer", "2026-05-09T00:00:01.000Z")
    ]);
    await saveSessionEvents("thread-silent", [
      userMessage("thread-silent", "turn-new", "new runtime event", "2026-05-09T00:00:02.000Z"),
      assistantMessage("thread-silent", "turn-new", "new answer", "2026-05-09T00:00:03.000Z")
    ], undefined, { includeTranscript: false });

    const tail = await loadSessionTranscriptTail("thread-silent");

    expect(tail?.chunk?.items).toMatchObject([
      { type: "message", message: { text: "old visible transcript" } },
      { type: "message", message: { text: "old answer" } }
    ]);
  });
});

function userMessage(threadId: string, turnId: string, text: string, createdAt: string): RuntimeEvent {
  return {
    id: `${turnId}-user`,
    seq: 0,
    threadId,
    turnId,
    createdAt,
    type: "user_message",
    text
  };
}

function done(threadId: string, turnId: string, createdAt: string): RuntimeEvent {
  return {
    id: `${turnId}-done`,
    seq: 1,
    threadId,
    turnId,
    createdAt,
    type: "turn_completed"
  };
}

function assistantMessage(threadId: string, turnId: string, text: string, createdAt: string): RuntimeEvent {
  return {
    id: `${turnId}-assistant`,
    seq: 1,
    threadId,
    turnId,
    createdAt,
    type: "assistant_message",
    text
  };
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}
