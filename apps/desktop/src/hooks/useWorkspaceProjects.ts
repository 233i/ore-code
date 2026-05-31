import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionSummary } from "../services/sessionStore";
export {
  addWorkspacePathPreservingOrder,
  formatWorkspacePathForDisplay,
  normalizeWorkspacePath,
  sameWorkspacePath,
  workspaceProjectName
} from "../services/workspacePath";
import {
  normalizeWorkspacePath,
  sameWorkspacePath,
  workspaceProjectName
} from "../services/workspacePath";

export type WorkspaceProject = {
  isCurrent: boolean;
  name: string;
  sessions: SessionSummary[];
  workspacePath: string;
};

type SidebarScrollSnapshot = {
  conversationListTops: Record<string, number>;
  outerTop: number;
  threadId: string;
};

type SidebarSessionOrder = Record<string, string[]>;

type SidebarOrderSnapshot = {
  projectOrder: string[];
  sessionOrder: SidebarSessionOrder;
};

export function useWorkspaceProjects(input: {
  currentSessionSummary: SessionSummary | null;
  onApplyWorkspacePath: (path: string) => Promise<void>;
  onStartNewSession: () => void;
  query: string;
  sessions: SessionSummary[];
  threadId: string;
  workspacePath: string;
}) {
  const [expandedProjectPaths, setExpandedProjectPaths] = useState<Record<string, boolean>>({});
  const projectGroupsRef = useRef<HTMLDivElement | null>(null);
  const sidebarOrderRef = useRef<SidebarOrderSnapshot>({ projectOrder: [], sessionOrder: {} });
  const [sidebarOrderVersion, setSidebarOrderVersion] = useState(0);
  const pendingSidebarScrollRef = useRef<SidebarScrollSnapshot | null>(null);

  const sidebarSessions = useMemo(
    () => mergeCurrentSessionSummary(input.sessions, input.currentSessionSummary),
    [input.currentSessionSummary, input.sessions]
  );
  const workspaceProjects = useMemo(() => {
    const grouped = new Map<string, SessionSummary[]>();

    for (const summary of sidebarSessions) {
      const summaryWorkspace = summary.workspacePath ?? ".";
      grouped.set(summaryWorkspace, [...(grouped.get(summaryWorkspace) ?? []), summary]);
    }

    const projects = [...grouped.entries()]
      .map(([projectWorkspacePath, projectSessions]): WorkspaceProject => ({
        isCurrent: sameWorkspacePath(projectWorkspacePath, input.workspacePath),
        name: workspaceProjectName(projectWorkspacePath),
        sessions: sortSessionsByStableOrder(projectSessions, projectWorkspacePath, sidebarOrderRef.current.sessionOrder),
        workspacePath: projectWorkspacePath
      }));
    return sortWorkspaceProjectsByStableOrder(projects, sidebarOrderRef.current.projectOrder);
  }, [sidebarOrderVersion, sidebarSessions, input.workspacePath]);
  const filteredWorkspaceProjects = useMemo(
    () => filterWorkspaceProjects(workspaceProjects, input.query),
    [input.query, workspaceProjects]
  );
  const sidebarSessionCount = filteredWorkspaceProjects.reduce((sum, project) => sum + project.sessions.length, 0);

  useEffect(() => {
    const snapshot = pendingSidebarScrollRef.current;
    if (!snapshot || snapshot.threadId !== input.threadId) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      const container = projectGroupsRef.current;
      if (!container) {
        pendingSidebarScrollRef.current = null;
        return;
      }

      container.scrollTop = snapshot.outerTop;
      for (const [workspaceKey, listTop] of Object.entries(snapshot.conversationListTops)) {
        const list = Array.from(container.querySelectorAll<HTMLElement>(".project-conversation-list"))
          .find((element) => sameWorkspacePath(element.dataset.workspacePath ?? ".", workspaceKey));
        if (list) {
          list.scrollTop = listTop;
        }
      }

      container.querySelector<HTMLElement>(".conversation-item.active")?.scrollIntoView({ block: "nearest" });
      pendingSidebarScrollRef.current = null;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [filteredWorkspaceProjects, input.threadId]);

  function captureSidebarScrollForThread(nextThreadId: string) {
    const container = projectGroupsRef.current;
    if (!container) {
      return;
    }

    const projectOrder = captureSidebarOrder();
    const conversationListTops: Record<string, number> = {};
    const sessionOrder: SidebarSessionOrder = { ...sidebarOrderRef.current.sessionOrder };
    for (const list of container.querySelectorAll<HTMLElement>(".project-conversation-list")) {
      const workspaceKey = list.dataset.workspacePath;
      if (workspaceKey) {
        conversationListTops[workspaceKey] = list.scrollTop;
        sessionOrder[normalizeWorkspacePath(workspaceKey)] = Array.from(
          list.querySelectorAll<HTMLElement>(".conversation-item")
        )
          .map((item) => item.dataset.threadId)
          .filter((threadId): threadId is string => Boolean(threadId));
      }
    }

    sidebarOrderRef.current = {
      projectOrder: projectOrder.length > 0 ? projectOrder : sidebarOrderRef.current.projectOrder,
      sessionOrder
    };
    setSidebarOrderVersion((version) => version + 1);

    pendingSidebarScrollRef.current = {
      conversationListTops,
      outerTop: container.scrollTop,
      threadId: nextThreadId
    };
  }

  function captureSidebarOrder() {
    const container = projectGroupsRef.current;
    if (!container) {
      return sidebarOrderRef.current.projectOrder;
    }

    const projectOrder = Array.from(container.querySelectorAll<HTMLElement>(".project-group"))
      .map((group) => group.dataset.workspacePath)
      .filter((workspacePath): workspacePath is string => Boolean(workspacePath))
      .map(normalizeWorkspacePath);

    if (projectOrder.length > 0) {
      sidebarOrderRef.current = {
        ...sidebarOrderRef.current,
        projectOrder
      };
      setSidebarOrderVersion((version) => version + 1);
    }

    return projectOrder.length > 0 ? projectOrder : sidebarOrderRef.current.projectOrder;
  }

  async function switchWorkspaceProject(projectWorkspacePath: string) {
    if (!sameWorkspacePath(projectWorkspacePath, input.workspacePath)) {
      await input.onApplyWorkspacePath(projectWorkspacePath);
      input.onStartNewSession();
    }
    setExpandedProjectPaths((current) => ({
      ...current,
      [projectWorkspacePath]: current[projectWorkspacePath] ?? true
    }));
  }

  function toggleWorkspaceProject(projectWorkspacePath: string) {
    setExpandedProjectPaths((current) => ({
      ...current,
      [projectWorkspacePath]: !(current[projectWorkspacePath] ?? true)
    }));
  }

  return {
    captureSidebarOrder,
    captureSidebarScrollForThread,
    expandedProjectPaths,
    filteredWorkspaceProjects,
    projectGroupsRef,
    searchableSessions: sidebarSessions,
    sidebarSessionCount,
    switchWorkspaceProject,
    toggleWorkspaceProject,
    workspaceProjects
  };
}

function filterWorkspaceProjects(projects: WorkspaceProject[], query: string): WorkspaceProject[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return projects;
  }

  return projects
    .map((project) => {
      const projectMatches = normalizeSearchText(`${project.name} ${project.workspacePath}`).includes(normalizedQuery);
      const sessions = projectMatches
        ? project.sessions
        : project.sessions.filter((session) =>
            normalizeSearchText(`${session.title} ${session.threadId} ${session.workspacePath ?? project.workspacePath}`).includes(normalizedQuery)
          );

      return projectMatches || sessions.length > 0 ? { ...project, sessions } : null;
    })
    .filter((project): project is WorkspaceProject => Boolean(project));
}

function mergeCurrentSessionSummary(sessions: SessionSummary[], currentSummary: SessionSummary | null): SessionSummary[] {
  if (!currentSummary) {
    return sessions;
  }

  const existingSummary = sessions.find((summary) => summary.threadId === currentSummary.threadId);
  if (!existingSummary) {
    return [currentSummary, ...sessions];
  }

  return sessions.map((summary) =>
    summary.threadId === currentSummary.threadId
      ? {
          ...currentSummary,
          updatedAt: summary.updatedAt,
          workspacePath: summary.workspacePath
        }
      : summary
  );
}

function sortWorkspaceProjectsByStableOrder(projects: WorkspaceProject[], projectOrder: string[]): WorkspaceProject[] {
  if (projectOrder.length === 0) {
    return projects;
  }

  const projectIndexes = new Map(projectOrder.map((workspacePath, index) => [normalizeWorkspacePath(workspacePath), index]));
  const sourceIndexes = new Map(projects.map((project, index) => [normalizeWorkspacePath(project.workspacePath), index]));
  return [...projects].sort((left, right) => {
    const leftIndex = projectIndexes.get(normalizeWorkspacePath(left.workspacePath));
    const rightIndex = projectIndexes.get(normalizeWorkspacePath(right.workspacePath));
    if (leftIndex !== undefined && rightIndex !== undefined) {
      return leftIndex - rightIndex;
    }
    if (leftIndex !== undefined) {
      return -1;
    }
    if (rightIndex !== undefined) {
      return 1;
    }
    return (sourceIndexes.get(normalizeWorkspacePath(left.workspacePath)) ?? 0) -
      (sourceIndexes.get(normalizeWorkspacePath(right.workspacePath)) ?? 0);
  });
}

function sortSessionsByStableOrder(
  sessions: SessionSummary[],
  workspacePath: string,
  workspaceSessionOrder: SidebarSessionOrder
): SessionSummary[] {
  const workspaceKey = normalizeWorkspacePath(workspacePath);
  const stableOrder = workspaceSessionOrder[workspaceKey];
  if (!stableOrder || stableOrder.length === 0) {
    return sessions;
  }

  const sessionIndexes = new Map(stableOrder.map((threadId, index) => [threadId, index]));
  const sourceIndexes = new Map(sessions.map((session, index) => [session.threadId, index]));
  return [...sessions].sort((left, right) => {
    const leftIndex = sessionIndexes.get(left.threadId);
    const rightIndex = sessionIndexes.get(right.threadId);
    if (leftIndex !== undefined && rightIndex !== undefined) {
      return leftIndex - rightIndex;
    }
    if (leftIndex !== undefined) {
      return -1;
    }
    if (rightIndex !== undefined) {
      return 1;
    }
    return (sourceIndexes.get(left.threadId) ?? 0) - (sourceIndexes.get(right.threadId) ?? 0);
  });
}

function normalizeSearchText(value: string) {
  return value.toLocaleLowerCase();
}
