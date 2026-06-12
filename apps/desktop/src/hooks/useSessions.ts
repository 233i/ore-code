import { startTransition, useRef, useState, type Dispatch, type MouseEvent, type MutableRefObject, type SetStateAction } from "react";
import type { RuntimeEvent, ToolCall } from "@ore-code/protocol";
import {
  latestTurnTrackedChangesFromEvents,
  type TrackedFileChange
} from "../features/changes/changeLedger";
import type { ChangeGroup } from "../features/changes/changeGroups";
import { transcriptItemsFromTail } from "../features/transcript/transcriptChunks";
import { deleteSession, listSessions, loadSessionEvents, loadSessionTranscriptTail, renameSession, saveSessionEvents, type SessionSummary } from "../services/sessionStore";
import {
  createTurnSnapshotStore,
  trackedChangesFromSnapshot
} from "../services/turnSnapshotStore";
import type { ComposerAttachment, MessageFeedback } from "../ui/composerTypes";
import type { TranscriptItem, TranscriptMessage } from "../ui/Transcript";

export type SessionContextMenu = {
  summary: Pick<SessionSummary, "threadId" | "title">;
  x: number;
  y: number;
} | null;

type TranscriptEventBase = {
  eventCount: number;
  items: TranscriptItem[];
  threadId: string;
};

type LoadedSessionRuntime = {
  events: RuntimeEvent[];
  trackedChanges: TrackedFileChange[];
};

export function useSessions(input: {
  events: RuntimeEvent[];
  setActiveTurnSkill: Dispatch<SetStateAction<{ id: string; name: string } | null>>;
  setChangeDiffPreview: Dispatch<SetStateAction<string>>;
  setClearedChangeTurnId: Dispatch<SetStateAction<string | null>>;
  setComposerAttachments: Dispatch<SetStateAction<ComposerAttachment[]>>;
  setEvents: Dispatch<SetStateAction<RuntimeEvent[]>>;
  setExpandedMessage: Dispatch<SetStateAction<TranscriptMessage | null>>;
  setMessageFeedback: Dispatch<SetStateAction<Record<string, MessageFeedback>>>;
  setPendingApproval: Dispatch<SetStateAction<ToolCall | null>>;
  setPromptText: Dispatch<SetStateAction<string>>;
  setSelectedChangeGroup: Dispatch<SetStateAction<ChangeGroup>>;
  setSelectedChangePath: Dispatch<SetStateAction<string | null>>;
  setSessionRuntimeLoading: Dispatch<SetStateAction<boolean>>;
  setShowInspector: Dispatch<SetStateAction<boolean>>;
  setShowNewSession: Dispatch<SetStateAction<boolean>>;
  setShowSearch: Dispatch<SetStateAction<boolean>>;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  setShowSkills: Dispatch<SetStateAction<boolean>>;
  setTaskFileChanges: Dispatch<SetStateAction<TrackedFileChange[]>>;
  setTranscriptItems: Dispatch<SetStateAction<TranscriptItem[]>>;
  setTranscriptEventBase: (base: TranscriptEventBase | null) => void;
  setThreadId: Dispatch<SetStateAction<string>>;
  setChangesMessage: Dispatch<SetStateAction<string | null>>;
  taskFileChangesRef: MutableRefObject<TrackedFileChange[]>;
  threadId: string;
  workspacePath: string;
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenu>(null);
  const loadSessionRequestIdRef = useRef(0);
  const loadedRuntimeCacheRef = useRef(new Map<string, LoadedSessionRuntime>());

  function startNewSession() {
    loadSessionRequestIdRef.current += 1;
    input.setShowNewSession(false);
    input.setShowSkills(false);
    input.setShowSettings(false);
    input.setShowSearch(false);
    input.setThreadId(createThreadId());
    input.setEvents([]);
    input.setTranscriptItems([]);
    input.setTranscriptEventBase(null);
    input.setSessionRuntimeLoading(false);
    input.taskFileChangesRef.current = [];
    input.setTaskFileChanges([]);
    input.setClearedChangeTurnId(null);
    input.setSelectedChangePath(null);
    input.setSelectedChangeGroup("turn");
    input.setChangeDiffPreview("");
    input.setPromptText("");
    input.setActiveTurnSkill(null);
    input.setPendingApproval(null);
    input.setComposerAttachments([]);
    input.setMessageFeedback({});
    input.setExpandedMessage(null);
    setSessionMessage("已创建新会话。");
  }

  async function persistSession(nextThreadId: string, nextEvents: RuntimeEvent[], options: { silent?: boolean } = {}) {
    try {
      const summary = await saveSessionEvents(nextThreadId, nextEvents, input.workspacePath, {
        includeTranscript: !options.silent
      });
      if (options.silent) {
        setSessions((current) => upsertSessionSummary(current, summary));
        return;
      }
      setSessionMessage(`已保存会话：${summary.title}`);
      await refreshSessions();
    } catch (error) {
      setSessionMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshSessions() {
    try {
      setSessions(await listSessions());
    } catch (error) {
      setSessionMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadSession(summary: SessionSummary) {
    const requestId = loadSessionRequestIdRef.current + 1;
    loadSessionRequestIdRef.current = requestId;
    const cacheKey = sessionRuntimeCacheKey(summary);
    const cachedRuntime = loadedRuntimeCacheRef.current.get(cacheKey);

    try {
      setSessionContextMenu(null);
      input.setShowSkills(false);
      input.setShowSettings(false);
      input.setShowSearch(false);
      input.setSessionRuntimeLoading(!cachedRuntime);

      const tail = await loadSessionTranscriptTail(summary.threadId);
      if (loadSessionRequestIdRef.current !== requestId) {
        return;
      }

      const tailItems = transcriptItemsFromTail(tail);
      const tailMatchesRuntime = tail?.updatedAt === summary.updatedAt;
      input.setTranscriptEventBase({
        eventCount: tailMatchesRuntime ? summary.eventCount : 0,
        items: tailMatchesRuntime ? tailItems : [],
        threadId: summary.threadId
      });

      startTransition(() => {
        input.setThreadId(summary.threadId);
        input.setTranscriptItems(tailItems);
        input.setEvents(cachedRuntime?.events ?? []);
        input.taskFileChangesRef.current = cachedRuntime?.trackedChanges ?? [];
        input.setTaskFileChanges(cachedRuntime?.trackedChanges ?? []);
        input.setClearedChangeTurnId(null);
        input.setSelectedChangePath(null);
        input.setSelectedChangeGroup("turn");
        input.setChangeDiffPreview("");
        input.setActiveTurnSkill(null);
        input.setPromptText("");
        input.setComposerAttachments([]);
        input.setMessageFeedback({});
        input.setExpandedMessage(null);
      });
      setSessionMessage(`已加载会话：${summary.title}`);

      if (cachedRuntime) {
        input.setSessionRuntimeLoading(false);
        return;
      }

      void hydrateSessionRuntime(summary, cacheKey, requestId);
    } catch (error) {
      if (loadSessionRequestIdRef.current === requestId) {
        input.setSessionRuntimeLoading(false);
      }
      setSessionMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function hydrateSessionRuntime(summary: SessionSummary, cacheKey: string, requestId: number) {
    try {
      const loadedRuntime = await loadSessionRuntime(summary.threadId, (error) => {
        input.setChangesMessage(`加载文件快照失败：${error instanceof Error ? error.message : String(error)}`);
      });
      loadedRuntimeCacheRef.current.set(cacheKey, loadedRuntime);
      if (loadSessionRequestIdRef.current !== requestId) {
        return;
      }
      startTransition(() => {
        input.setEvents(loadedRuntime.events);
        input.taskFileChangesRef.current = loadedRuntime.trackedChanges;
        input.setTaskFileChanges(loadedRuntime.trackedChanges);
      });
    } catch (error) {
      if (loadSessionRequestIdRef.current === requestId) {
        setSessionMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (loadSessionRequestIdRef.current === requestId) {
        input.setSessionRuntimeLoading(false);
      }
    }
  }

  function beginRenameSession(summary: Pick<SessionSummary, "threadId" | "title">) {
    setSessionContextMenu(null);
    setRenamingThreadId(summary.threadId);
    setRenameDraft(summary.title);
  }

  async function commitRenameSession(threadIdToRename = renamingThreadId, titleOverride?: string) {
    if (!threadIdToRename) {
      return;
    }

    const title = (titleOverride ?? renameDraft).trim();
    if (!title) {
      setSessionMessage("会话标题不能为空。");
      return;
    }

    try {
      const renamed = await renameSession(threadIdToRename, title);
      setSessions((current) =>
        current.map((summary) => summary.threadId === renamed.threadId ? { ...summary, title: renamed.title } : summary)
      );
      setRenamingThreadId(null);
      setRenameDraft("");
      setSessionMessage(`已重命名会话：${renamed.title}`);
    } catch (error) {
      setSessionMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function openSessionContextMenu(
    event: MouseEvent,
    summary: Pick<SessionSummary, "threadId" | "title">
  ) {
    event.preventDefault();
    const menuWidth = 176;
    const menuHeight = 116;
    setSessionContextMenu({
      summary,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
    });
  }

  async function copySessionTitle(title: string) {
    try {
      await navigator.clipboard.writeText(title);
      setSessionMessage("已复制会话标题。");
    } catch (error) {
      setSessionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionContextMenu(null);
    }
  }

  async function removeSession(summary: Pick<SessionSummary, "threadId" | "title">) {
    setSessionContextMenu(null);
    try {
      await deleteSession(summary.threadId);
      setSessions((current) => current.filter((item) => item.threadId !== summary.threadId));
      setSessionMessage(`已删除会话：${summary.title}`);
      if (summary.threadId === input.threadId) {
        startNewSession();
      }
    } catch (error) {
      setSessionMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function renameCurrentSessionFromCommand(title: string) {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setSessionMessage("用法：/rename 新标题");
      return;
    }

    if (input.events.length > 0 && !sessions.some((summary) => summary.threadId === input.threadId)) {
      await persistSession(input.threadId, input.events);
    }

    setRenamingThreadId(input.threadId);
    setRenameDraft(nextTitle);
    await commitRenameSession(input.threadId, nextTitle);
  }

  return {
    sessions,
    setSessions,
    sessionMessage,
    setSessionMessage,
    renamingThreadId,
    setRenamingThreadId,
    renameDraft,
    setRenameDraft,
    sessionContextMenu,
    setSessionContextMenu,
    startNewSession,
    persistSession,
    refreshSessions,
    loadSession,
    beginRenameSession,
    commitRenameSession,
    openSessionContextMenu,
    copySessionTitle,
    removeSession,
    renameCurrentSessionFromCommand
  };
}

function upsertSessionSummary(summaries: SessionSummary[], summary: SessionSummary): SessionSummary[] {
  return [summary, ...summaries.filter((item) => item.threadId !== summary.threadId)].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) || left.threadId.localeCompare(right.threadId)
  );
}

function createThreadId() {
  return `thread-${crypto.randomUUID()}`;
}

async function loadSessionRuntime(threadId: string, onSnapshotLoadError?: (error: unknown) => void): Promise<LoadedSessionRuntime> {
  const events = await loadSessionEvents(threadId);
  let trackedChanges = latestTurnTrackedChangesFromEvents(events);
  const snapshotId = latestSnapshotIdFromEvents(events);
  if (snapshotId) {
    try {
      const snapshot = await createTurnSnapshotStore().loadTurnSnapshot(snapshotId);
      trackedChanges = trackedChangesFromSnapshot(snapshot);
    } catch (error) {
      onSnapshotLoadError?.(error);
      // Fall back to the event-derived change list; the caller owns user-facing error state.
    }
  }

  return { events, trackedChanges };
}

function sessionRuntimeCacheKey(summary: SessionSummary) {
  return `${summary.threadId}:${summary.eventCount}:${summary.updatedAt}`;
}

function latestSnapshotIdFromEvents(events: RuntimeEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "turn_snapshot") {
      return event.snapshotId;
    }
    if (event.type === "file_changed" && event.snapshotId) {
      return event.snapshotId;
    }
  }
  return null;
}
