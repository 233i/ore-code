import { useEffect, useRef, useState } from "react";
import { projectIndexStatusFromRefreshResult, shouldRefreshProjectIndexAfterIndexedAt } from "./appShellUtils";
import type { ProjectIndexStatus } from "./appTypes";
import { createRuntimeFileHost } from "../services/fileHost";
import { refreshProjectIndex } from "../services/projectIndex";
import type { RuntimeEvent } from "@ore-code/protocol";

export function useProjectIndexController({
  events,
  settingsLoaded,
  workspacePath
}: {
  events: RuntimeEvent[];
  settingsLoaded: boolean;
  workspacePath: string;
}) {
  const [projectIndexStatus, setProjectIndexStatus] = useState<ProjectIndexStatus>({
    documentCount: 0,
    state: "idle"
  });
  const projectIndexRefreshIdRef = useRef(0);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }
    if (workspacePath === ".") {
      projectIndexRefreshIdRef.current += 1;
      setProjectIndexStatus({ documentCount: 0, state: "idle" });
      return;
    }

    const refreshId = ++projectIndexRefreshIdRef.current;
    const cancelRefresh = scheduleIdleProjectIndexRefresh(() => {
      if (refreshId !== projectIndexRefreshIdRef.current) {
        return;
      }
      setProjectIndexStatus({
        documentCount: 0,
        message: "正在建立项目索引...",
        state: "indexing"
      });
      void runProjectIndexRefresh(refreshId, workspacePath);
    });

    return cancelRefresh;
  }, [settingsLoaded, workspacePath]);

  useEffect(() => {
    if (!settingsLoaded || workspacePath === ".") {
      return;
    }

    const latestEvent = events[events.length - 1];
    if (!latestEvent || !shouldRefreshProjectIndexAfterIndexedAt(latestEvent, projectIndexStatus.updatedAt)) {
      return;
    }

    const refreshId = ++projectIndexRefreshIdRef.current;
    const cancelRefresh = scheduleIdleProjectIndexRefresh(() => {
      if (refreshId !== projectIndexRefreshIdRef.current) {
        return;
      }
      setProjectIndexStatus((current) => ({
        ...current,
        message: "正在增量刷新索引...",
        state: "indexing"
      }));
      void runProjectIndexRefresh(refreshId, workspacePath);
    }, 1800);

    return cancelRefresh;
  }, [events.length, projectIndexStatus.updatedAt, settingsLoaded, workspacePath]);

  async function runProjectIndexRefresh(refreshId: number, targetWorkspacePath: string) {
    try {
      const result = await refreshProjectIndex({
        fileHost: createRuntimeFileHost(),
        workspacePath: targetWorkspacePath
      });
      if (refreshId !== projectIndexRefreshIdRef.current) {
        return;
      }
      setProjectIndexStatus(projectIndexStatusFromRefreshResult(result));
    } catch (error) {
      if (refreshId !== projectIndexRefreshIdRef.current) {
        return;
      }
      setProjectIndexStatus((current) => ({
        ...current,
        message: error instanceof Error ? error.message : String(error),
        state: "error"
      }));
    }
  }

  return { projectIndexStatus };
}

type IdleSchedulerWindow = Window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
};

function scheduleIdleProjectIndexRefresh(callback: () => void, timeoutMs = 1500) {
  const idleWindow = window as IdleSchedulerWindow;
  if (typeof idleWindow.requestIdleCallback === "function") {
    const idleId = idleWindow.requestIdleCallback(callback, { timeout: timeoutMs });
    return () => idleWindow.cancelIdleCallback?.(idleId);
  }

  const timer = window.setTimeout(callback, timeoutMs);
  return () => window.clearTimeout(timer);
}
