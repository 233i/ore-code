import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntimeNoteStore } from "./noteStore";

describe("noteStore browser fallback", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createMemoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips workspace and global notes", async () => {
    const store = createRuntimeNoteStore("/workspace/a");
    await store.add({
      id: "note-1",
      kind: "decision",
      text: "Use prompt pack sections.",
      scope: "workspace",
      tags: [],
      workspacePath: "/workspace/a",
      createdAt: "2026-05-20T00:00:00.000Z"
    });
    await store.add({
      id: "note-2",
      kind: "preference",
      text: "Prefer Chinese answers.",
      scope: "global",
      tags: [],
      workspacePath: "*",
      createdAt: "2026-05-20T00:00:01.000Z"
    });

    await expect(store.listNotes()).resolves.toHaveLength(2);
    await store.deleteNote("note-1");
    await expect(store.listNotes()).resolves.toMatchObject([{ id: "note-2" }]);
  });
});

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
