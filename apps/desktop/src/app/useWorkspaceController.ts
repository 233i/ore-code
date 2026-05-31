import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../services/fileHost";
import {
  addWorkspacePathPreservingOrder,
  formatWorkspacePathForDisplay,
  workspaceProjectName
} from "../hooks/useWorkspaceProjects";

export function useWorkspaceController({
  onBeforeApplyWorkspacePath,
  onWorkspacePathReady
}: {
  onBeforeApplyWorkspacePath: () => void;
  onWorkspacePathReady: () => void;
}) {
  const [workspace, setWorkspace] = useState("未选择");
  const [workspacePath, setWorkspacePath] = useState(".");
  const [workspaceInput, setWorkspaceInput] = useState(".");
  const [recentWorkspacePaths, setRecentWorkspacePaths] = useState<string[]>([]);

  const currentProjectName = useMemo(() => workspaceProjectName(workspacePath), [workspacePath]);
  const currentWorkspaceLabel = workspacePath === "." ? "未选择工作区" : currentProjectName;
  const currentWorkspaceDisplay = workspacePath === "." ? workspace : formatWorkspacePathForDisplay(workspacePath);

  async function loadWorkspaceStatus() {
    if (!isTauriRuntime()) {
      setWorkspace("浏览器预览：无 Tauri 文件系统访问");
      setWorkspacePath(".");
      setWorkspaceInput(".");
      return;
    }

    try {
      const status = await invoke<{ cwd: string; appDataDir: string }>("workspace_status");
      setWorkspace(status.cwd);
      setWorkspacePath(status.cwd);
      setWorkspaceInput(status.cwd);
      onWorkspacePathReady();
    } catch (error) {
      setWorkspace(error instanceof Error ? error.message : String(error));
    }
  }

  async function chooseWorkspace() {
    if (!isTauriRuntime()) {
      setWorkspace("浏览器预览：请输入路径用于界面演示；真实文件访问需要 Tauri 桌面端。");
      return;
    }

    const selected = await open({ directory: true, multiple: false, title: "选择 SeekForge 工作区" });
    if (typeof selected === "string") {
      await applyWorkspacePath(selected);
    }
  }

  async function applyWorkspacePath(path = workspaceInput) {
    onBeforeApplyWorkspacePath();
    if (!isTauriRuntime()) {
      const nextPath = path || ".";
      setWorkspacePath(nextPath);
      setWorkspaceInput(nextPath);
      setRecentWorkspacePaths((current) => addWorkspacePathPreservingOrder(current, nextPath));
      setWorkspace(`浏览器预览：${nextPath}`);
      return;
    }

    try {
      const result = await invoke<{ path: string }>("workspace_validate", { path });
      setWorkspacePath(result.path);
      setRecentWorkspacePaths((current) => addWorkspacePathPreservingOrder(current, result.path));
      setWorkspaceInput(result.path);
      setWorkspace(result.path);
      onWorkspacePathReady();
    } catch (error) {
      setWorkspace(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadWorkspaceSettings(path: string, paths: string[]) {
    setWorkspacePath(path);
    setRecentWorkspacePaths(paths);
    setWorkspaceInput(path);
    if (path !== ".") {
      await applyWorkspacePath(path);
    }
  }

  return {
    applyWorkspacePath,
    chooseWorkspace,
    currentProjectName,
    currentWorkspaceDisplay,
    currentWorkspaceLabel,
    loadWorkspaceSettings,
    loadWorkspaceStatus,
    recentWorkspacePaths,
    setRecentWorkspacePaths,
    setWorkspaceInput,
    workspace,
    workspaceInput,
    workspacePath
  };
}
