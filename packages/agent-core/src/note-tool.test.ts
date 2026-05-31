import { describe, expect, it } from "vitest";
import type { NoteRecord, NoteStore } from "./note-tool";
import { createNoteTools } from "./note-tool";

describe("note tools", () => {
  it("lists memory as an index and reads full memory body lazily", async () => {
    const note: NoteRecord = {
      id: "note-1",
      kind: "architecture",
      scope: "workspace",
      tags: ["cache"],
      text: "Keep prefix cache layers stable and load large context bodies only when needed.",
      workspacePath: "/repo",
      createdAt: "2026-05-28T00:00:00.000Z"
    };
    const store = memoryStore([note]);
    const [, noteList, noteRead] = createNoteTools(store);
    const runtimeEvents: unknown[] = [];
    const context = {
      workspacePath: "/repo",
      mode: "agent" as const,
      trustedWorkspace: true,
      onRuntimeEvent: (event: unknown) => runtimeEvents.push(event)
    };

    await expect(noteList.execute({}, context)).resolves.toMatchObject({
      ok: true,
      output: {
        notes: [{
          id: "note-1",
          summary: expect.stringContaining("Keep prefix cache")
        }]
      }
    });
    expect((await noteList.execute({}, context)).output?.notes[0]).not.toHaveProperty("text");

    await expect(noteRead.execute({ id: "note-1" }, context)).resolves.toMatchObject({
      ok: true,
      output: { note: { text: note.text } }
    });
    expect(runtimeEvents).toContainEqual(expect.objectContaining({
      type: "lazy_context_loaded",
      source: "memory",
      sourceId: "note-1",
      contentChars: 0
    }));
  });
});

function memoryStore(initial: NoteRecord[]): NoteStore {
  const notes = [...initial];
  return {
    async add(record) {
      notes.push(record);
    },
    async delete(id) {
      const index = notes.findIndex((note) => note.id === id);
      if (index >= 0) {
        notes.splice(index, 1);
      }
    },
    async list(workspacePath) {
      return notes.filter((note) => note.workspacePath === "*" || note.workspacePath === workspacePath);
    }
  };
}
