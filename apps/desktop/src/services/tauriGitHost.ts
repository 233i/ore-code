import { invoke } from "@tauri-apps/api/core";
import type {
  GitBranchHostOutput,
  GitDiffHostOutput,
  GitStatusHostOutput,
  GitTextHostOutput,
  GitToolHost
} from "@ore-code/tools";

export function createTauriGitHost(): GitToolHost {
  return {
    async status(input): Promise<GitStatusHostOutput> {
      return invoke<GitStatusHostOutput>("git_status", input);
    },
    async diff(input): Promise<GitDiffHostOutput> {
      return invoke<GitDiffHostOutput>("git_diff", input);
    },
    async branch(input): Promise<GitBranchHostOutput> {
      return invoke<GitBranchHostOutput>("git_branch", input);
    },
    async log(input): Promise<GitTextHostOutput> {
      return invoke<GitTextHostOutput>("git_log", input);
    },
    async show(input): Promise<GitTextHostOutput> {
      return invoke<GitTextHostOutput>("git_show", input);
    },
    async blame(input): Promise<GitTextHostOutput> {
      return invoke<GitTextHostOutput>("git_blame", input);
    }
  };
}
