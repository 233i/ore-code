import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { RuntimeEvent } from "@ore-code/protocol";
import type { TrackedFileChange } from "../features/changes/changeLedger";
import type { ChangeGroup } from "../features/changes/changeGroups";
import { createTurnSnapshotStore } from "../services/turnSnapshotStore";
import type { AppMode, PermissionPreset } from "../ui/permissionPreset";

export function useTurnRestore(input: {
  events: RuntimeEvent[];
  mode: AppMode;
  permissionPreset: PermissionPreset;
  persistSession: (threadId: string, events: RuntimeEvent[], options?: { silent?: boolean }) => Promise<void>;
  refreshChanges: () => Promise<void>;
  setChangeDiffPreview: Dispatch<SetStateAction<string>>;
  setChangesMessage: Dispatch<SetStateAction<string | null>>;
  setClearedChangeTurnId: Dispatch<SetStateAction<string | null>>;
  setSelectedChangeGroup: Dispatch<SetStateAction<ChangeGroup>>;
  setSelectedChangePath: Dispatch<SetStateAction<string | null>>;
  setSessionMessage: Dispatch<SetStateAction<string | null>>;
  setTaskFileChanges: Dispatch<SetStateAction<TrackedFileChange[]>>;
  setEvents: Dispatch<SetStateAction<RuntimeEvent[]>>;
  taskFileChangesRef: MutableRefObject<TrackedFileChange[]>;
  threadId: string;
  workspacePath: string;
}) {
  function appendSnapshotRestoredEvent(eventInput: {
    failures: string[];
    ok: boolean;
    paths: string[];
    scope: "file" | "turn";
    snapshotId: string;
    turnId: string;
  }) {
    input.setEvents((current) => {
      const event: RuntimeEvent = {
        id: crypto.randomUUID(),
        seq: nextSeq(current),
        threadId: input.threadId,
        turnId: eventInput.turnId,
        createdAt: new Date().toISOString(),
        type: "snapshot_restored",
        snapshotId: eventInput.snapshotId,
        paths: eventInput.paths,
        scope: eventInput.scope,
        ok: eventInput.ok,
        failures: eventInput.failures.length > 0 ? eventInput.failures : undefined
      };
      const nextEvents = [...current, event];
      void input.persistSession(input.threadId, nextEvents, { silent: true });
      return nextEvents;
    });
  }

  async function restoreTurnFromCommand(args: string) {
    const restorableTurns = listRestorableTurns(input.events);
    if (restorableTurns.length === 0) {
      input.setSessionMessage("没有可恢复的 turn snapshot。");
      input.setChangesMessage("没有可恢复的 turn snapshot。");
      return;
    }

    const trimmed = args.trim();
    if (!trimmed) {
      const lines = restorableTurns
        .slice(0, 8)
        .map((turn, index) => `${index + 1}. ${turn.title} · ${turn.fileCount} files · ${turn.snapshotId}`)
        .join("\n");
      input.setSessionMessage(`Recent snapshots:\n${lines}`);
      input.setChangesMessage(`Recent snapshots:\n${lines}`);
      return;
    }

    const index = Number(trimmed);
    if (!Number.isInteger(index) || index < 1 || index > restorableTurns.length) {
      input.setSessionMessage(`用法：/restore <N>，N 范围 1-${restorableTurns.length}`);
      return;
    }

    if (input.mode !== "yolo" && input.permissionPreset !== "fullAccess") {
      input.setSessionMessage(`恢复历史 turn 需要完全访问权限。请先切换到 /yolo 后再执行 /restore ${index}。`);
      return;
    }

    const target = restorableTurns[index - 1];
    try {
      const result = await createTurnSnapshotStore().restoreTurnSnapshot(target.snapshotId, input.workspacePath);
      appendSnapshotRestoredEvent({
        snapshotId: target.snapshotId,
        turnId: target.turnId,
        paths: result.restoredFiles,
        scope: "turn",
        ok: result.ok,
        failures: result.failures
      });
      if (result.ok) {
        if (target.turnId === latestUserTurnIdFromEvents(input.events)) {
          input.taskFileChangesRef.current = [];
          input.setTaskFileChanges([]);
          input.setSelectedChangePath(null);
          input.setSelectedChangeGroup("turn");
          input.setChangeDiffPreview("");
        }
        input.setClearedChangeTurnId(target.turnId);
        input.setChangesMessage(`已恢复 snapshot #${index}：${target.title}`);
        input.setSessionMessage(`已恢复 snapshot #${index}：${target.title}`);
        await input.refreshChanges();
        return;
      }

      input.setChangesMessage(`恢复 snapshot #${index} 失败：${result.failures.join("；")}`);
      input.setSessionMessage(`恢复 snapshot #${index} 失败。`);
    } catch (error) {
      input.setChangesMessage(`恢复 snapshot #${index} 失败：${error instanceof Error ? error.message : String(error)}`);
      input.setSessionMessage(`恢复 snapshot #${index} 失败。`);
    }
  }

  return {
    appendSnapshotRestoredEvent,
    restoreTurnFromCommand
  };
}

function nextSeq(events: RuntimeEvent[]) {
  return events.reduce((max, event) => Math.max(max, event.seq), -1) + 1;
}

function latestUserTurnIdFromEvents(events: RuntimeEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "user_message") {
      return event.turnId;
    }
  }
  return null;
}

function listRestorableTurns(events: RuntimeEvent[]) {
  const turns: Array<{
    fileCount: number;
    snapshotId: string;
    title: string;
    turnId: string;
  }> = [];
  const seen = new Set<string>();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "turn_snapshot") {
      if (seen.has(event.turnId)) {
        continue;
      }
      seen.add(event.turnId);
      const userMessage = events.find((candidate) => candidate.turnId === event.turnId && candidate.type === "user_message");
      turns.push({
        fileCount: event.fileCount,
        snapshotId: event.snapshotId,
        title: summarizeRestoreTitle(
          userMessage?.type === "user_message" ? userMessage.text : event.turnId
        ),
        turnId: event.turnId
      });
    }
  }
  return turns;
}

function summarizeRestoreTitle(text: string) {
  const normalized = text.split(/\s+/).filter(Boolean).join(" ");
  if (normalized.length <= 48) {
    return normalized || "Untitled turn";
  }
  return `${normalized.slice(0, 45)}...`;
}
