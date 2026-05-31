import type { GitToolHost } from "@seekforge/tools";
import { isTauriRuntime } from "./fileHost";
import { createTauriGitHost } from "./tauriGitHost";

export function createRuntimeGitHost(): GitToolHost {
  if (isTauriRuntime()) {
    return createTauriGitHost();
  }

  return createBrowserPreviewGitHost();
}

function createBrowserPreviewGitHost(): GitToolHost {
  return {
    async status() {
      return {
        isRepo: false,
        entries: [],
        raw: "",
        error: "Browser preview does not have Tauri Git access. Run the Tauri app for real Git status."
      };
    },
    async diff() {
      return {
        isRepo: false,
        diff: "",
        error: "Browser preview does not have Tauri Git access. Run the Tauri app for real Git diff."
      };
    },
    async branch() {
      return {
        isRepo: false,
        branches: [],
        raw: "",
        error: "Browser preview does not have Tauri Git access. Run the Tauri app for real Git branches."
      };
    },
    async log() {
      return {
        isRepo: false,
        output: "",
        error: "Browser preview does not have Tauri Git access. Run the Tauri app for real Git log."
      };
    },
    async show() {
      return {
        isRepo: false,
        output: "",
        error: "Browser preview does not have Tauri Git access. Run the Tauri app for real Git show."
      };
    },
    async blame() {
      return {
        isRepo: false,
        output: "",
        error: "Browser preview does not have Tauri Git access. Run the Tauri app for real Git blame."
      };
    }
  };
}
