import { invoke } from "@tauri-apps/api/core";
import type { NoteRecord, NoteStore } from "@ore-code/agent-core";
import { isTauriRuntime } from "./fileHost";

const BROWSER_NOTES_KEY = "ore-code.notes";

export function createRuntimeNoteStore(workspacePath: string): NoteStore & {
  listNotes(): Promise<NoteRecord[]>;
  deleteNote(id: string): Promise<void>;
} {
  const store = isTauriRuntime() ? createTauriNoteStore(workspacePath) : createBrowserNoteStore(workspacePath);
  return {
    ...store,
    listNotes: () => store.list(workspacePath),
    deleteNote: (id) => store.delete(id)
  };
}

function createTauriNoteStore(workspacePath: string): NoteStore {
  return {
    async add(record) {
      await invoke("note_add", { note: record });
    },
    async list() {
      return await invoke<NoteRecord[]>("note_list", { workspacePath });
    },
    async delete(id) {
      await invoke("note_delete", { id });
    }
  };
}

function createBrowserNoteStore(workspacePath: string): NoteStore {
  return {
    async add(record) {
      const notes = readBrowserNotes().filter((note) => note.id !== record.id);
      notes.push(record);
      writeBrowserNotes(notes);
    },
    async list() {
      return readBrowserNotes().filter((note) => note.workspacePath === "*" || note.workspacePath === workspacePath);
    },
    async delete(id) {
      writeBrowserNotes(readBrowserNotes().filter((note) => note.id !== id));
    }
  };
}

function readBrowserNotes(): NoteRecord[] {
  try {
    const raw = window.localStorage.getItem(BROWSER_NOTES_KEY);
    return raw ? JSON.parse(raw) as NoteRecord[] : [];
  } catch {
    return [];
  }
}

function writeBrowserNotes(notes: NoteRecord[]) {
  window.localStorage.setItem(BROWSER_NOTES_KEY, JSON.stringify(notes));
}
