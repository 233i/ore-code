import { useState } from "react";
import type { ListDirOutput } from "@seekforge/tools";
import { createRuntimeFileHost } from "../services/fileHost";

export type FilePanelEntry = ListDirOutput["entries"][number];

export function useFilePanel(input: {
  setPromptText: (value: string) => void;
  workspacePath: string;
}) {
  const [filePanelPath, setFilePanelPath] = useState(".");
  const [fileEntries, setFileEntries] = useState<FilePanelEntry[]>([]);
  const [filePanelMessage, setFilePanelMessage] = useState<string | null>(null);

  async function refreshFiles(path = filePanelPath) {
    try {
      const output = await createRuntimeFileHost().listDir({ workspacePath: input.workspacePath, path });
      setFileEntries(output.entries);
      setFilePanelMessage(`${output.entries.length} entries`);
    } catch (error) {
      setFileEntries([]);
      setFilePanelMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function openFileEntry(entry: FilePanelEntry) {
    const nextPath = workspaceRelativePath(entry.path, input.workspacePath);
    if (entry.isDir) {
      setFilePanelPath(nextPath);
      await refreshFiles(nextPath);
      return;
    }

    input.setPromptText(`读取 @${nextPath}`);
  }

  async function goUpDirectory() {
    const nextPath = parentWorkspacePath(filePanelPath);
    setFilePanelPath(nextPath);
    await refreshFiles(nextPath);
  }

  return {
    fileEntries,
    filePanelMessage,
    filePanelPath,
    goUpDirectory,
    openFileEntry,
    refreshFiles,
    setFilePanelPath
  };
}

function workspaceRelativePath(path: string, workspacePath: string) {
  if (workspacePath !== "." && path.startsWith(workspacePath)) {
    const relative = path.slice(workspacePath.length).replace(/^[/\\]+/, "");
    return relative || ".";
  }

  return path || ".";
}

function parentWorkspacePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized || normalized === ".") {
    return ".";
  }

  const segments = normalized.split("/");
  segments.pop();
  return segments.join("/") || ".";
}
