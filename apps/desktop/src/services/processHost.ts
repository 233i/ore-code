import { invoke } from "@tauri-apps/api/core";
import { defaultSandboxPolicy, type ProcessRunOutput, type ProcessToolHost } from "@ore-code/tools";
import { isTauriRuntime } from "./fileHost";

export function createRuntimeProcessHost(): ProcessToolHost {
  if (isTauriRuntime()) {
    return createTauriProcessHost();
  }

  return createBrowserPreviewProcessHost();
}

function createTauriProcessHost(): ProcessToolHost {
  return {
    async run(input): Promise<ProcessRunOutput> {
      const processInput = {
        args: input.args,
        program: input.program,
        sandboxPolicy: input.sandboxPolicy ?? defaultSandboxPolicy(),
        stdin: input.stdin,
        timeoutMs: input.timeoutMs,
        workspacePath: input.workspacePath
      };
      return invoke<ProcessRunOutput>("process_run", { input: processInput });
    }
  };
}

function createBrowserPreviewProcessHost(): ProcessToolHost {
  return {
    async run(input): Promise<ProcessRunOutput> {
      const stderr = "Browser preview does not execute local processes. Run the Tauri app for real process execution.";
      input.onOutput?.({ stream: "stderr", text: stderr });
      return {
        program: input.program,
        args: input.args ?? [],
        command: [input.program, ...(input.args ?? [])].join(" "),
        exitCode: 127,
        stdout: "",
        stderr,
        durationMs: 0,
        timedOut: false,
        sandbox: input.sandboxPolicy
          ? {
              enabled: input.sandboxPolicy.enabled,
              envMode: input.sandboxPolicy.envMode,
              sensitiveEnvFiltered: 0,
              processTreeKill: false
            }
          : undefined
      };
    }
  };
}
