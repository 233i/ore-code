import { startTransition, useState, type Dispatch, type MouseEvent, type MutableRefObject, type SetStateAction } from "react";
import type { RuntimeEvent, ToolCall } from "@seekforge/protocol";
import {
  latestTurnTrackedChangesFromEvents,
  type TrackedFileChange
} from "../features/changes/changeLedger";
import type { ChangeGroup } from "../features/changes/changeGroups";
import { transcriptItemsFromRecentEvents, transcriptItemsFromTail } from "../features/transcript/transcriptChunks";
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
  setShowInspector: Dispatch<SetStateAction<boolean>>;
  setShowNewSession: Dispatch<SetStateAction<boolean>>;
  setShowSearch: Dispatch<SetStateAction<boolean>>;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  setShowSkills: Dispatch<SetStateAction<boolean>>;
  setTaskFileChanges: Dispatch<SetStateAction<TrackedFileChange[]>>;
  setTranscriptItems: Dispatch<SetStateAction<TranscriptItem[]>>;
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

  function startNewSession() {
    input.setShowNewSession(false);
    input.setShowSkills(false);
    input.setShowSettings(false);
    input.setShowSearch(false);
    input.setThreadId(createThreadId());
    input.setEvents([]);
    input.setTranscriptItems([]);
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
    try {
      setSessionContextMenu(null);
      input.setShowSkills(false);
      input.setShowSettings(false);
      input.setShowSearch(false);
      const [transcriptTail, loadedEvents] = await Promise.all([
        loadSessionTranscriptTail(summary.threadId),
        loadSessionEvents(summary.threadId)
      ]);
      const transcriptItems = transcriptItemsFromTail(transcriptTail);
      const visibleTranscriptItems = transcriptItems.length > 0
        ? transcriptItems
        : transcriptItemsFromRecentEvents(loadedEvents);
      let restoredChanges = latestTurnTrackedChangesFromEvents(loadedEvents);
      const snapshotId = latestSnapshotIdFromEvents(loadedEvents);
      if (snapshotId) {
        try {
          const snapshot = await createTurnSnapshotStore().loadTurnSnapshot(snapshotId);
          restoredChanges = trackedChangesFromSnapshot(snapshot);
        } catch (error) {
          input.setChangesMessage(`加载文件快照失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      startTransition(() => {
        input.setThreadId(summary.threadId);
        input.setTranscriptItems(visibleTranscriptItems);
        input.setEvents(loadedEvents);
        input.taskFileChangesRef.current = restoredChanges;
        input.setTaskFileChanges(restoredChanges);
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
    } catch (error) {
      setSessionMessage(error instanceof Error ? error.message : String(error));
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

function createThreadId() {
  return `thread-${crypto.randomUUID()}`;
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
