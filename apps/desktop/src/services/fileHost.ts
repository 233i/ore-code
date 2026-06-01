import type {
  FileSearchOutput,
  FileToolHost,
  GrepFilesOutput,
  ListDirOutput,
  ReadFileOutput,
  WriteFileOutput
} from "@ore-code/tools";
import { createTauriFileHost } from "./tauriFileHost";

export function createRuntimeFileHost(): FileToolHost {
  if (isTauriRuntime()) {
    return createTauriFileHost();
  }

  return createBrowserPreviewFileHost();
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function createBrowserPreviewFileHost(): FileToolHost {
  return {
    async readText(input): Promise<ReadFileOutput> {
      return {
        path: input.path,
        content: "Browser preview does not have Tauri filesystem access. Run the Tauri app for real file reads."
      };
    },
    async listDir(input): Promise<ListDirOutput> {
      return {
        entries: [
          {
            name: "Tauri filesystem access is unavailable in browser preview",
            path: input.workspacePath,
            isDir: false
          }
        ]
      };
    },
    async searchFiles(input): Promise<FileSearchOutput> {
      return {
        matches: [
          {
            name: "Browser preview search is unavailable",
            path: input.workspacePath,
            isDir: false
          }
        ],
        truncated: false
      };
    },
    async grepFiles(input): Promise<GrepFilesOutput> {
      return {
        matches: [
          {
            path: input.workspacePath,
            lineNumber: 1,
            line: `Browser preview cannot grep real files. Pattern: ${input.pattern}`,
            matchStart: 0,
            matchEnd: 0
          }
        ],
        truncated: false
      };
    },
    async writeText(input): Promise<WriteFileOutput> {
      return {
        path: input.path,
        bytesWritten: input.content.length
      };
    },
    async deleteFile(): Promise<void> {
      return;
    }
  };
}
