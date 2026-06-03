import { invoke } from "@tauri-apps/api/core";
import { eventsFromJsonl, eventsToJsonl, summarizeSession, type SessionSummary } from "@ore-code/state";
import { parseRuntimeEvent, type RuntimeEvent } from "@ore-code/protocol";
import {
  buildTranscriptChunkBundle,
  type TranscriptChunkBundle,
  type TranscriptTailLoad
} from "../features/transcript/transcriptChunks";
import { isTauriRuntime } from "./fileHost";

const BROWSER_SESSION_INDEX_KEY = "ore-code.sessions.index";
const BROWSER_SESSION_PREFIX = "ore-code.sessions.";
const BROWSER_SESSION_TRANSCRIPT_PREFIX = "ore-code.sessions.transcript.";
const BROWSER_SESSION_TITLES_KEY = "ore-code.sessions.titles";
const BROWSER_SESSION_WORKSPACES_KEY = "ore-code.sessions.workspaces";

export type { SessionSummary };

export async function saveSessionEvents(
  threadId: string,
  events: RuntimeEvent[],
  workspacePath?: string,
  options: { includeTranscript?: boolean } = {}
): Promise<SessionSummary> {
  const includeTranscript = options.includeTranscript ?? true;
  const transcript = includeTranscript ? buildTranscriptChunkBundle(threadId, events) : undefined;
  if (isTauriRuntime()) {
    return invoke<SessionSummary>("session_save_events", { threadId, events, workspacePath, transcript });
  }

  const titleOverride = readBrowserSessionTitles()[threadId];
  const summary = {
    ...(titleOverride ? { ...summarizeSession(threadId, events), title: titleOverride } : summarizeSession(threadId, events)),
    ...(workspacePath ? { workspacePath } : {})
  };
  browserStorage().setItem(browserSessionKey(threadId), eventsToJsonl(events));
  if (transcript) {
    browserStorage().setItem(browserSessionTranscriptKey(threadId), JSON.stringify(transcript));
  }
  writeBrowserSessionIndex(upsertSummary(readBrowserSessionIndex(), summary));
  if (workspacePath) {
    const workspaces = readBrowserSessionWorkspaces();
    workspaces[threadId] = workspacePath;
    writeBrowserSessionWorkspaces(workspaces);
  }
  return summary;
}

export async function listSessions(): Promise<SessionSummary[]> {
  if (isTauriRuntime()) {
    return invoke<SessionSummary[]>("session_list_threads");
  }

  const workspaces = readBrowserSessionWorkspaces();
  return readBrowserSessionIndex().map((summary) => ({
    ...summary,
    workspacePath: summary.workspacePath ?? workspaces[summary.threadId]
  }));
}

export async function loadSessionEvents(threadId: string): Promise<RuntimeEvent[]> {
  if (isTauriRuntime()) {
    const rawEvents = await invoke<unknown[]>("session_load_thread", { threadId });
    return rawEvents.map((event) => parseRuntimeEvent(event));
  }

  const jsonl = browserStorage().getItem(browserSessionKey(threadId));
  return eventsFromJsonl(jsonl ?? "");
}

export async function loadSessionTranscriptTail(threadId: string): Promise<TranscriptTailLoad | null> {
  const transcript = isTauriRuntime()
    ? await invoke<TranscriptChunkBundle | null>("session_load_transcript_tail", { threadId })
    : readBrowserSessionTranscript(threadId);
  return transcriptLoadFromBundle(transcript);
}

export async function loadSessionTranscriptChunk(threadId: string, chunkIndex: number): Promise<TranscriptTailLoad | null> {
  const transcript = isTauriRuntime()
    ? await invoke<TranscriptChunkBundle | null>("session_load_transcript_chunk", { threadId, chunkIndex })
    : transcriptChunkFromBrowserBundle(threadId, chunkIndex);
  return transcriptLoadFromBundle(transcript);
}

function transcriptLoadFromBundle(transcript: TranscriptChunkBundle | null): TranscriptTailLoad | null {
  if (!transcript) {
    return null;
  }

  const chunk = transcript.chunks[transcript.chunks.length - 1] ?? null;
  const hiddenItemCount = chunk
    ? hiddenItemCountBeforeChunk(transcript, chunk.index)
    : transcript.totalItemCount;
  return {
    chunk,
    hiddenItemCount,
    previousChunkIndex: chunk && chunk.index > 0 ? chunk.index - 1 : null,
    totalItemCount: transcript.totalItemCount
  };
}

export async function renameSession(threadId: string, title: string): Promise<SessionSummary> {
  const normalizedTitle = normalizeSessionTitle(title);
  if (isTauriRuntime()) {
    return invoke<SessionSummary>("session_rename_thread", { threadId, title: normalizedTitle });
  }

  const summaries = readBrowserSessionIndex();
  const existing = summaries.find((summary) => summary.threadId === threadId);
  if (!existing) {
    throw new Error("session not found");
  }

  const titles = readBrowserSessionTitles();
  titles[threadId] = normalizedTitle;
  writeBrowserSessionTitles(titles);
  const renamed = { ...existing, title: normalizedTitle };
  writeBrowserSessionIndex(upsertSummary(summaries, renamed));
  return renamed;
}

export async function deleteSession(threadId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("session_delete_thread", { threadId });
    return;
  }

  browserStorage().removeItem(browserSessionKey(threadId));
  browserStorage().removeItem(browserSessionTranscriptKey(threadId));
  writeBrowserSessionIndex(readBrowserSessionIndex().filter((summary) => summary.threadId !== threadId));
  const titles = readBrowserSessionTitles();
  delete titles[threadId];
  writeBrowserSessionTitles(titles);
  const workspaces = readBrowserSessionWorkspaces();
  delete workspaces[threadId];
  writeBrowserSessionWorkspaces(workspaces);
}

function browserSessionKey(threadId: string): string {
  return `${BROWSER_SESSION_PREFIX}${threadId}`;
}

function browserSessionTranscriptKey(threadId: string): string {
  return `${BROWSER_SESSION_TRANSCRIPT_PREFIX}${threadId}`;
}

function readBrowserSessionTranscript(threadId: string): TranscriptChunkBundle | null {
  const raw = browserStorage().getItem(browserSessionTranscriptKey(threadId));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as TranscriptChunkBundle;
  } catch {
    return null;
  }
}

function transcriptChunkFromBrowserBundle(threadId: string, chunkIndex: number): TranscriptChunkBundle | null {
  const transcript = readBrowserSessionTranscript(threadId);
  if (!transcript) {
    return null;
  }

  const chunk = transcript.chunks.find((item) => item.index === chunkIndex) ?? null;
  return chunk ? { ...transcript, chunks: [chunk] } : null;
}

function hiddenItemCountBeforeChunk(transcript: TranscriptChunkBundle, chunkIndex: number): number {
  return Math.max(0, Math.min(transcript.totalItemCount, chunkIndex * transcript.chunkSize));
}

function upsertSummary(summaries: SessionSummary[], summary: SessionSummary): SessionSummary[] {
  return [summary, ...summaries.filter((item) => item.threadId !== summary.threadId)].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

function readBrowserSessionIndex(): SessionSummary[] {
  const raw = browserStorage().getItem(BROWSER_SESSION_INDEX_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as SessionSummary[];
  } catch {
    return [];
  }
}

function writeBrowserSessionIndex(summaries: SessionSummary[]): void {
  browserStorage().setItem(BROWSER_SESSION_INDEX_KEY, JSON.stringify(summaries));
}

function readBrowserSessionTitles(): Record<string, string> {
  const raw = browserStorage().getItem(BROWSER_SESSION_TITLES_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeBrowserSessionTitles(titles: Record<string, string>): void {
  browserStorage().setItem(BROWSER_SESSION_TITLES_KEY, JSON.stringify(titles));
}

function readBrowserSessionWorkspaces(): Record<string, string> {
  const raw = browserStorage().getItem(BROWSER_SESSION_WORKSPACES_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeBrowserSessionWorkspaces(workspaces: Record<string, string>): void {
  browserStorage().setItem(BROWSER_SESSION_WORKSPACES_KEY, JSON.stringify(workspaces));
}

function normalizeSessionTitle(title: string) {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error("会话标题不能为空");
  }

  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function browserStorage(): Storage {
  return window.localStorage;
}
