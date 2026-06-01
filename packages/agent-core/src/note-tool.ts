import { z } from "zod";
import type { ToolSpec } from "@ore-code/tools";
import { createLazyContextEventBody } from "./lazy-context";

const NOTE_KINDS = ["preference", "decision", "blocker", "architecture"] as const;

const NoteInputSchema = z.object({
  kind: z.enum(NOTE_KINDS),
  text: z.string().trim().min(8).max(1_000),
  scope: z.enum(["global", "workspace"]).optional().default("workspace"),
  tags: z.array(z.string().trim().min(1).max(32)).max(8).optional().default([])
});
const NoteListInputSchema = z.object({
  query: z.string().trim().max(120).optional()
}).strict();
const NoteReadInputSchema = z.object({
  id: z.string().trim().min(1)
}).strict();

export type NoteInput = z.infer<typeof NoteInputSchema>;

export interface NoteRecord extends NoteInput {
  id: string;
  workspacePath: string;
  createdAt: string;
}

export interface NoteStore {
  add(record: NoteRecord): Promise<void>;
  list(workspacePath: string): Promise<NoteRecord[]>;
  delete(id: string): Promise<void>;
}

export function createNoteTool(store: NoteStore): ToolSpec<NoteInput, { note: NoteRecord }> {
  return {
    name: "note",
    description: "Persist a durable, user-useful memory: preference, project decision, long-lived blocker, or architecture constraint. Do not store secrets or temporary logs.",
    capability: "readonly",
    approval: "never",
    inputSchema: NoteInputSchema,
    modelParameters: {
      type: "object",
      required: ["kind", "text"],
      properties: {
        kind: { type: "string", enum: NOTE_KINDS },
        text: { type: "string", minLength: 8, maxLength: 1000 },
        scope: { type: "string", enum: ["global", "workspace"] },
        tags: { type: "array", items: { type: "string" } }
      }
    },
    async execute(rawInput, context) {
      const input = NoteInputSchema.parse(rawInput);
      const note: NoteRecord = {
        ...input,
        id: `note-${crypto.randomUUID()}`,
        workspacePath: input.scope === "global" ? "*" : context.workspacePath,
        createdAt: new Date().toISOString()
      };
      await store.add(note);
      return { callId: context.toolCallId ?? "note", ok: true, output: { note } };
    }
  };
}

export function createNoteTools(store: NoteStore): [
  ToolSpec<NoteInput, { note: NoteRecord }>,
  ToolSpec<z.infer<typeof NoteListInputSchema>, { notes: NoteIndexRecord[] }>,
  ToolSpec<z.infer<typeof NoteReadInputSchema>, { note: NoteRecord }>
] {
  return [
    createNoteTool(store),
    createNoteListTool(store),
    createNoteReadTool(store)
  ];
}

export interface NoteIndexRecord {
  id: string;
  kind: NoteRecord["kind"];
  scope: NoteRecord["scope"];
  tags: string[];
  createdAt: string;
  summary: string;
}

export function createNoteListTool(store: NoteStore): ToolSpec<z.infer<typeof NoteListInputSchema>, { notes: NoteIndexRecord[] }> {
  return {
    name: "note_list",
    description: "List durable memory entries as a lightweight index. Use note_read for the full memory body only when relevant.",
    capability: "readonly",
    approval: "never",
    inputSchema: NoteListInputSchema,
    modelParameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional keyword filter for memory index entries." }
      },
      additionalProperties: false
    },
    async execute(rawInput, context) {
      const input = NoteListInputSchema.parse(rawInput);
      const notes = (await store.list(context.workspacePath))
        .map(toNoteIndexRecord)
        .filter((note) => noteMatchesQuery(note, input.query))
        .slice(0, 64);
      return { callId: context.toolCallId ?? "note_list", ok: true, output: { notes } };
    }
  };
}

export function createNoteReadTool(store: NoteStore): ToolSpec<z.infer<typeof NoteReadInputSchema>, { note: NoteRecord }> {
  return {
    name: "note_read",
    description: "Read one durable memory entry by id after inspecting note_list. The memory body is loaded lazily into the conversation.",
    capability: "readonly",
    approval: "never",
    inputSchema: NoteReadInputSchema,
    modelParameters: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Memory id returned by note_list." }
      },
      additionalProperties: false
    },
    async execute(rawInput, context) {
      const input = NoteReadInputSchema.parse(rawInput);
      const note = (await store.list(context.workspacePath)).find((record) => record.id === input.id);
      if (!note) {
        return {
          callId: context.toolCallId ?? "note_read",
          ok: false,
          error: {
            code: "note_not_found",
            message: `Memory note is not available: ${input.id}`
          }
        };
      }
      context.onRuntimeEvent?.(createLazyContextEventBody({
        source: "memory",
        sourceId: note.id,
        title: `${note.kind} memory`,
        summary: summarizeNoteText(note.text)
      }));
      return { callId: context.toolCallId ?? "note_read", ok: true, output: { note } };
    }
  };
}

function toNoteIndexRecord(note: NoteRecord): NoteIndexRecord {
  return {
    id: note.id,
    kind: note.kind,
    scope: note.scope,
    tags: note.tags,
    createdAt: note.createdAt,
    summary: summarizeNoteText(note.text)
  };
}

function noteMatchesQuery(note: NoteIndexRecord, query: string | undefined) {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return [note.id, note.kind, note.scope, note.summary, ...note.tags]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function summarizeNoteText(text: string) {
  const oneLine = text.trim().replace(/\s+/g, " ");
  return oneLine.length <= 180 ? oneLine : `${oneLine.slice(0, 177)}...`;
}
