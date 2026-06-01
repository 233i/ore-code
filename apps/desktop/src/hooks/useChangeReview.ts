import { useMemo, useRef, useState, type MutableRefObject } from "react";
import type { RuntimeEvent } from "@ore-code/protocol";
import {
  buildVisibleTurnChanges,
  latestTrackedChangeForPath,
  latestTurnTrackedChangesFromEvents,
  undoTrackedChanges,
  type TrackedFileChange
} from "../features/changes/changeLedger";
import {
  buildChangeReviewGroups,
  type ChangeGroup
} from "../features/changes/changeGroups";
import { buildTaskChangeFileStats } from "../features/changes/changeSummary";
import { createRuntimeFileHost } from "../services/fileHost";
import { createRuntimeGitHost } from "../services/gitHost";
import {
  generateLightweightCommitMessage,
  generateLightweightReviewComment,
  type LightweightReviewResult
} from "../services/lightweightCompletion";
import { detectPreferredLanguage } from "../services/preferredLanguage";
import { createTurnSnapshotStore } from "../services/turnSnapshotStore";
import type { LlmClient } from "@ore-code/agent-core";
import type { GitStatusHostOutput } from "@ore-code/tools";

type SnapshotRestoredEventInput = {
  failures: string[];
  ok: boolean;
  paths: string[];
  scope: "file" | "turn";
  snapshotId: string;
  turnId: string;
};

export type ChangeReviewPanel = "Artifacts" | "Changes" | "Files" | "Jobs" | "Usage";

export type UseChangeReviewInput = {
  appendSnapshotRestoredEventRef: MutableRefObject<((event: SnapshotRestoredEventInput) => void) | null>;
  createConfiguredProviderClient: (reason: string) => Promise<LlmClient | null>;
  events: RuntimeEvent[];
  onOpenPanel: (panel: ChangeReviewPanel) => void;
  setPromptText: (value: string) => void;
  setSessionMessageRef: MutableRefObject<((value: string | null) => void) | null>;
  workspacePath: string;
};

export function useChangeReview({
  appendSnapshotRestoredEventRef,
  createConfiguredProviderClient,
  events,
  onOpenPanel,
  setPromptText,
  setSessionMessageRef,
  workspacePath
}: UseChangeReviewInput) {
  const [gitStatus, setGitStatus] = useState<GitStatusHostOutput | null>(null);
  const [gitPanelDiffs, setGitPanelDiffs] = useState({ staged: "", unstaged: "" });
  const [changesMessage, setChangesMessage] = useState<string | null>(null);
  const [selectedChangePath, setSelectedChangePath] = useState<string | null>(null);
  const [selectedChangeGroup, setSelectedChangeGroup] = useState<ChangeGroup>("turn");
  const [expandedChangeGroups, setExpandedChangeGroups] = useState<Record<ChangeGroup, boolean>>({
    turn: false,
    unstaged: false,
    staged: false
  });
  const [changeDiffPreview, setChangeDiffPreview] = useState("");
  const [taskFileChanges, setTaskFileChanges] = useState<TrackedFileChange[]>([]);
  const [clearedChangeTurnId, setClearedChangeTurnId] = useState<string | null>(null);
  const [lightweightReview, setLightweightReview] = useState<(LightweightReviewResult & { group: ChangeGroup; path: string }) | null>(null);
  const [lightweightReviewRunning, setLightweightReviewRunning] = useState(false);
  const [lightweightCommitMessage, setLightweightCommitMessage] = useState<LightweightReviewResult | null>(null);
  const [lightweightCommitMessageRunning, setLightweightCommitMessageRunning] = useState(false);
  const taskFileChangesRef = useRef<TrackedFileChange[]>([]);

  const taskChangeFileStats = useMemo(() => buildTaskChangeFileStats(events), [events]);
  const latestChangeTurnId = useMemo(() => latestUserTurnIdFromEvents(events), [events]);
  const visibleTaskChangeFileStats =
    latestChangeTurnId && clearedChangeTurnId === latestChangeTurnId
      ? []
      : buildVisibleTurnChanges(events, taskFileChanges, taskChangeFileStats);
  const changeReviewGroups = useMemo(
    () => buildChangeReviewGroups({
      gitStatus,
      stagedDiff: gitPanelDiffs.staged,
      turnFiles: visibleTaskChangeFileStats,
      unstagedDiff: gitPanelDiffs.unstaged
    }),
    [gitPanelDiffs.staged, gitPanelDiffs.unstaged, gitStatus, visibleTaskChangeFileStats]
  );
  const changeReviewFiles = useMemo(
    () => changeReviewGroups.flatMap((group) => group.files),
    [changeReviewGroups]
  );
  const changeReviewFileCount = changeReviewGroups.reduce((sum, group) => sum + group.files.length, 0);
  const selectedChangeFile = changeReviewFiles.find(
    (file) => file.path === selectedChangePath && file.group === selectedChangeGroup
  ) ?? null;
  const totalReviewAdditions = changeReviewFiles.reduce((sum, file) => sum + file.additions, 0);
  const totalReviewDeletions = changeReviewFiles.reduce((sum, file) => sum + file.deletions, 0);

  async function refreshChanges() {
    try {
      const gitHost = createRuntimeGitHost();
      const status = await gitHost.status({ workspacePath });
      const [unstagedDiff, stagedDiff] = await Promise.all([
        gitHost.diff({ workspacePath, staged: false }).catch(() => ({ diff: "" })),
        gitHost.diff({ workspacePath, staged: true }).catch(() => ({ diff: "" }))
      ]);
      setGitStatus(status);
      setGitPanelDiffs({ staged: stagedDiff.diff, unstaged: unstagedDiff.diff });
      setChangesMessage(status.error ?? `${status.entries.length} changed files`);
      const hasSelectedGitPath = status.entries.some((entry) => entry.path === selectedChangePath);
      const hasSelectedTurnPath = visibleTaskChangeFileStats.some((entry) => entry.path === selectedChangePath);
      if (selectedChangePath && !hasSelectedGitPath && !hasSelectedTurnPath) {
        setSelectedChangePath(null);
        setSelectedChangeGroup("turn");
        setChangeDiffPreview("");
      } else if (selectedChangePath) {
        setChangeDiffPreview(await readChangeDiff(selectedChangePath, selectedChangeGroup));
      }
    } catch (error) {
      setGitStatus(null);
      setGitPanelDiffs({ staged: "", unstaged: "" });
      setSelectedChangePath(null);
      setSelectedChangeGroup("turn");
      setChangeDiffPreview("");
      setChangesMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function selectChangeFile(path: string, group: ChangeGroup = "turn") {
    setSelectedChangePath(path);
    setSelectedChangeGroup(group);
    setChangeDiffPreview("Loading diff...");
    setChangeDiffPreview(await readChangeDiff(path, group));
  }

  async function readChangeDiff(path: string, group: ChangeGroup = "turn") {
    if (group === "turn") {
      const trackedChange = latestTrackedChangeForPath(taskFileChangesRef.current, path);
      if (trackedChange) {
        return trackedChange.diff;
      }

      const persistedChange = latestFileChangeEventForPath(events, path);
      if (persistedChange?.diff) {
        return persistedChange.diff;
      }
    }

    try {
      const result = await createRuntimeGitHost().diff({ workspacePath, staged: group === "staged", path });
      const emptyLabel = group === "staged" ? "No staged diff for this file." : "No unstaged diff for this file.";
      return result.error ?? (result.diff || emptyLabel);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  function useChangeInPrompt(path: string, group: ChangeGroup = selectedChangeGroup) {
    setPromptText(`查看 diff @${path}`);
    void selectChangeFile(path, group);
  }

  function reviewChanges() {
    onOpenPanel("Changes");
    const firstPath = selectedChangePath ?? visibleTaskChangeFileStats[0]?.path;
    if (firstPath) {
      void selectChangeFile(firstPath);
    }
    void refreshChanges();
  }

  function requestUndoChanges() {
    onOpenPanel("Changes");
    void undoLatestTaskChanges();
  }

  function canUndoChangeFile(path: string) {
    return visibleTaskChangeFileStats.some((file) => file.path === path);
  }

  async function copyChangeDiff(path: string, group: ChangeGroup = selectedChangeGroup) {
    const diff = path === selectedChangePath && selectedChangeGroup === group
      ? changeDiffPreview
      : await readChangeDiff(path, group);
    try {
      await navigator.clipboard.writeText(diff);
      setChangesMessage(`已复制 diff：${path}`);
    } catch (error) {
      setChangesMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function generateLightweightReview(path: string, group: ChangeGroup = selectedChangeGroup) {
    setLightweightReviewRunning(true);
    setChangesMessage("正在使用 FIM 轻量通道生成 review comment...");
    try {
      const diff = path === selectedChangePath && selectedChangeGroup === group
        ? changeDiffPreview
        : await readChangeDiff(path, group);
      const client = await createConfiguredProviderClient("FIM lightweight review");
      if (!client) {
        setChangesMessage("轻量评审未运行：当前 provider 没有可用 API Key。");
        return;
      }

      const result = await generateLightweightReviewComment(client, { path, diff });
      setLightweightReview({ ...result, path, group });
      setChangesMessage(`轻量评审完成：${lightweightModeLabel(result.mode)}`);
    } catch (error) {
      setChangesMessage(`轻量评审失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLightweightReviewRunning(false);
    }
  }

  async function generateLightweightCommitMessageForChanges() {
    setLightweightCommitMessageRunning(true);
    setChangesMessage("正在使用 FIM 轻量通道生成 commit message...");
    try {
      const diff = [gitPanelDiffs.staged, gitPanelDiffs.unstaged].filter(Boolean).join("\n\n");
      const activeDiff = diff || (selectedChangePath ? await readChangeDiff(selectedChangePath, selectedChangeGroup) : "");
      if (!activeDiff.trim()) {
        setChangesMessage("没有可用于生成 commit message 的 diff。");
        return;
      }
      const client = await createConfiguredProviderClient("FIM commit message");
      if (!client) {
        setChangesMessage("commit message 未生成：当前 provider 没有可用 API Key。");
        return;
      }

      const language = detectPreferredLanguage(events, "zh");
      const result = await generateLightweightCommitMessage(client, { diff: activeDiff, language });
      setLightweightCommitMessage(result);
      setChangesMessage(`commit message 已生成：${lightweightModeLabel(result.mode)}`);
    } catch (error) {
      setChangesMessage(`commit message 生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLightweightCommitMessageRunning(false);
    }
  }

  async function undoChangeFile(path: string) {
    if (!canUndoChangeFile(path)) {
      setChangesMessage("只能撤销本轮任务产生的文件变更。");
      return;
    }

    const snapshotId = latestSnapshotIdFromEvents(events);
    const turnId = latestUserTurnIdFromEvents(events);
    if (!turnId) {
      setChangesMessage("当前任务没有可撤销的文件变更。");
      return;
    }

    if (snapshotId) {
      try {
        const result = await createTurnSnapshotStore().restoreTurnSnapshotFile(snapshotId, workspacePath, path);
        appendSnapshotRestoredEventRef.current?.({
          snapshotId,
          turnId,
          paths: [path],
          scope: "file",
          ok: result.ok,
          failures: result.failures
        });

        if (result.ok) {
          taskFileChangesRef.current = taskFileChangesRef.current.filter((change) => change.path !== path);
          setTaskFileChanges(taskFileChangesRef.current);
          if (selectedChangePath === path) {
            setSelectedChangePath(null);
            setSelectedChangeGroup("turn");
            setChangeDiffPreview("");
          }
          setChangesMessage(`已撤销 ${path}`);
          setSessionMessageRef.current?.(`已撤销 ${path}`);
          await refreshChanges();
          return;
        }

        setChangesMessage(`撤销 ${path} 失败：${result.failures.join("；")}`);
        return;
      } catch (error) {
        setChangesMessage(`读取快照失败：${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }

    const changes = (taskFileChangesRef.current.length > 0
      ? taskFileChangesRef.current
      : latestTurnTrackedChangesFromEvents(events)).filter((change) => change.path === path);
    if (changes.length === 0) {
      setChangesMessage(`${path} 没有可撤销记录。`);
      return;
    }

    const result = await undoTrackedChanges(createRuntimeFileHost(), workspacePath, changes);
    appendSnapshotRestoredEventRef.current?.({
      snapshotId: `event-log-${turnId}`,
      turnId,
      paths: [path],
      scope: "file",
      ok: result.ok,
      failures: result.failures
    });
    if (result.ok) {
      taskFileChangesRef.current = taskFileChangesRef.current.filter((change) => change.path !== path);
      setTaskFileChanges(taskFileChangesRef.current);
      setChangesMessage(`已撤销 ${path}`);
      setSessionMessageRef.current?.(`已撤销 ${path}`);
      await refreshChanges();
      return;
    }

    setChangesMessage(`撤销 ${path} 失败：${result.failures.join("；")}`);
  }

  async function undoLatestTaskChanges() {
    const snapshotId = latestSnapshotIdFromEvents(events);
    if (snapshotId) {
      try {
        const result = await createTurnSnapshotStore().restoreTurnSnapshot(snapshotId, workspacePath);
        const turnId = latestUserTurnIdFromEvents(events);
        if (turnId) {
          appendSnapshotRestoredEventRef.current?.({
            snapshotId,
            turnId,
            paths: result.restoredFiles,
            scope: "turn",
            ok: result.ok,
            failures: result.failures
          });
        }
        if (result.ok) {
          taskFileChangesRef.current = [];
          setTaskFileChanges([]);
          setClearedChangeTurnId(latestUserTurnIdFromEvents(events));
          setSelectedChangePath(null);
          setSelectedChangeGroup("turn");
          setChangeDiffPreview("");
          setChangesMessage(`已从快照撤销 ${result.restoredFiles.length} 个文件变更。`);
          await refreshChanges();
          return;
        }

        setChangesMessage(`部分快照撤销失败：${result.failures.join("；")}`);
        return;
      } catch (error) {
        setChangesMessage(`读取快照失败，尝试使用事件记录撤销：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const changes = taskFileChangesRef.current.length > 0
      ? taskFileChangesRef.current
      : latestTurnTrackedChangesFromEvents(events);
    if (changes.length === 0) {
      setChangesMessage("当前任务没有可撤销的文件变更。");
      return;
    }

    const result = await undoTrackedChanges(createRuntimeFileHost(), workspacePath, changes);
    const turnId = latestUserTurnIdFromEvents(events);
    if (turnId) {
      appendSnapshotRestoredEventRef.current?.({
        snapshotId: `event-log-${turnId}`,
        turnId,
        paths: changes.map((change) => change.path),
        scope: "turn",
        ok: result.ok,
        failures: result.failures
      });
    }
    if (result.ok) {
      taskFileChangesRef.current = [];
      setTaskFileChanges([]);
      setClearedChangeTurnId(latestUserTurnIdFromEvents(events));
      setSelectedChangePath(null);
      setSelectedChangeGroup("turn");
      setChangeDiffPreview("");
      setChangesMessage(`已撤销 ${changes.length} 个文件写入动作。`);
      await refreshChanges();
      return;
    }

    setChangesMessage(`部分撤销失败：${result.failures.join("；")}`);
  }

  return {
    changeDiffPreview,
    changeReviewFileCount,
    changeReviewFiles,
    changeReviewGroups,
    changesMessage,
    clearTaskFileChanges() {
      taskFileChangesRef.current = [];
      setTaskFileChanges([]);
    },
    copyChangeDiff,
    expandedChangeGroups,
    generateLightweightReview,
    generateLightweightCommitMessageForChanges,
    lightweightReview,
    lightweightReviewRunning,
    lightweightCommitMessage,
    lightweightCommitMessageRunning,
    refreshChanges,
    requestUndoChanges,
    reviewChanges,
    selectedChangeFile,
    selectedChangeGroup,
    selectedChangePath,
    selectChangeFile,
    setChangeDiffPreview,
    setChangesMessage,
    setClearedChangeTurnId,
    setExpandedChangeGroups,
    setSelectedChangeGroup,
    setSelectedChangePath,
    setTaskFileChanges,
    taskFileChangesRef,
    totalReviewAdditions,
    totalReviewDeletions,
    undoChangeFile,
    useChangeInPrompt,
    visibleTaskChangeFileStats,
    canUndoChangeFile
  };
}

function lightweightModeLabel(mode: LightweightReviewResult["mode"]) {
  switch (mode) {
    case "fim":
      return "FIM";
    case "chat-prefix-fallback":
      return "prefix fallback";
    case "chat-fallback":
      return "chat fallback";
  }
}

function latestFileChangeEventForPath(events: RuntimeEvent[], path: string) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "file_changed" && (event.path === path || event.path.endsWith(`/${path}`))) {
      return event;
    }
  }

  return null;
}

function latestSnapshotIdFromEvents(events: RuntimeEvent[]) {
  const turnId = latestUserTurnIdFromEvents(events);
  if (!turnId) {
    return null;
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.turnId === turnId && event.type === "turn_snapshot") {
      return event.snapshotId;
    }
    if (event.turnId === turnId && event.type === "file_changed" && event.snapshotId) {
      return event.snapshotId;
    }
  }

  return null;
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
