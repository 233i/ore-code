import { useEffect, useRef, useState } from "react";
import { projectIndexStatusFromRefreshResult, shouldRefreshProjectIndexForEvent } from "./appShellUtils";
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
    setProjectIndexStatus({
      documentCount: 0,
      message: "正在建立项目索引...",
      state: "indexing"
    });
    const timer = window.setTimeout(() => {
      void runProjectIndexRefresh(refreshId, workspacePath);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [settingsLoaded, workspacePath]);

  useEffect(() => {
    if (!settingsLoaded || workspacePath === ".") {
      return;
    }

    const latestEvent = events[events.length - 1];
    if (!latestEvent || !shouldRefreshProjectIndexForEvent(latestEvent)) {
      return;
    }

    const refreshId = ++projectIndexRefreshIdRef.current;
    setProjectIndexStatus((current) => ({
      ...current,
      message: "正在增量刷新索引...",
      state: "indexing"
    }));
    const timer = window.setTimeout(() => {
      void runProjectIndexRefresh(refreshId, workspacePath);
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [events.length, settingsLoaded, workspacePath]);

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
