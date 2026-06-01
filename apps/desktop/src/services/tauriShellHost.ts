import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ShellRunOutput, ShellToolHost } from "@ore-code/tools";
import type { ShellJobHost, ShellJobRecord } from "./shellHost";

type ShellRunOutputEvent = {
  runId: string;
  stream: "stdout" | "stderr";
  text: string;
};

export function createTauriShellHost(): ShellToolHost {
  return {
    async run(input): Promise<ShellRunOutput> {
      const { onOutput, ...commandInput } = input;
      if (!onOutput) {
        return invoke<ShellRunOutput>("shell_run", commandInput);
      }

      const runId = crypto.randomUUID();
      let receivedDelta = false;
      const unlisten = await listen<ShellRunOutputEvent>("shell_run_output", (event) => {
        if (event.payload.runId !== runId) {
          return;
        }
        receivedDelta = true;
        onOutput({
          stream: event.payload.stream,
          text: event.payload.text
        });
      });

      try {
        const output = await invoke<ShellRunOutput>("shell_run", { ...commandInput, runId });
        await flushQueuedTauriEvents();
        if (!receivedDelta) {
          if (output.stdout) {
            onOutput({ stream: "stdout", text: output.stdout });
          }
          if (output.stderr) {
            onOutput({ stream: "stderr", text: output.stderr });
          }
        }
        return output;
      } finally {
        unlisten();
      }
    }
  };
}

function flushQueuedTauriEvents() {
  return new Promise((resolve) => window.setTimeout(resolve, 50));
}

export function createTauriShellJobHost(): ShellJobHost {
  return {
    async start(input): Promise<ShellJobRecord> {
      return invoke<ShellJobRecord>("shell_job_start", input);
    },
    async get(input): Promise<ShellJobRecord> {
      return invoke<ShellJobRecord>("shell_job_get", { jobId: input.jobId });
    },
    async list(): Promise<ShellJobRecord[]> {
      return invoke<ShellJobRecord[]>("shell_job_list");
    },
    async cancel(jobId): Promise<ShellJobRecord> {
      return invoke<ShellJobRecord>("shell_job_cancel", { jobId });
    }
  };
}
