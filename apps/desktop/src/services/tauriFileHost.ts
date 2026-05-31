import { invoke } from "@tauri-apps/api/core";
import type {
  FileSearchOutput,
  FileToolHost,
  GrepFilesOutput,
  ListDirOutput,
  ReadFileOutput,
  WriteFileOutput
} from "@seekforge/tools";

interface TauriFsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
}

export function createTauriFileHost(): FileToolHost {
  return {
    async readText(input): Promise<ReadFileOutput> {
      return invoke<ReadFileOutput>("fs_read_text", input);
    },
    async listDir(input): Promise<ListDirOutput> {
      const entries = await invoke<TauriFsEntry[]>("fs_list_dir", input);
      return { entries };
    },
    async searchFiles(input): Promise<FileSearchOutput> {
      return invoke<FileSearchOutput>("fs_search_files", input);
    },
    async grepFiles(input): Promise<GrepFilesOutput> {
      return invoke<GrepFilesOutput>("fs_grep_files", input);
    },
    async writeText(input): Promise<WriteFileOutput> {
      return invoke<WriteFileOutput>("fs_write_text", input);
    },
    async deleteFile(input): Promise<void> {
      await invoke("fs_delete_file", input);
    }
  };
}
