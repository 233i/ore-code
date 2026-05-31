import { useEffect, useState } from "react";
import { createRuntimeShellJobHost, type ShellJobRecord } from "../services/shellHost";

export function useShellJobsPanel(input: {
  activePanel: string;
  onOpenJobsPanel: () => void;
  promptText: string;
  workspacePath: string;
}) {
  const [runtimeShellJobs, setRuntimeShellJobs] = useState<ShellJobRecord[]>([]);
  const [jobMessage, setJobMessage] = useState<string | null>(null);

  useEffect(() => {
    if (input.activePanel !== "Jobs" || !runtimeShellJobs.some(isLiveShellJob)) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refreshRuntimeShellJobs();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [input.activePanel, runtimeShellJobs]);

  async function refreshRuntimeShellJobs() {
    try {
      setRuntimeShellJobs(await createRuntimeShellJobHost().list());
      setJobMessage(null);
    } catch (error) {
      setJobMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function startBackgroundShellJob() {
    const command = promptToShellCommand(input.promptText);
    if (!command) {
      setJobMessage("请输入要后台运行的 shell 命令。");
      return;
    }

    try {
      const job = await createRuntimeShellJobHost().start({
        workspacePath: input.workspacePath,
        command,
        timeoutMs: 300_000
      });
      setRuntimeShellJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setJobMessage(`已启动后台任务：${command}`);
      input.onOpenJobsPanel();
    } catch (error) {
      setJobMessage(error instanceof Error ? error.message : String(error));
      input.onOpenJobsPanel();
    }
  }

  async function cancelBackgroundShellJob(jobId: string) {
    try {
      const job = await createRuntimeShellJobHost().cancel(jobId);
      setRuntimeShellJobs((current) => current.map((item) => (item.id === job.id ? job : item)));
      setJobMessage(`正在取消后台任务：${job.command}`);
    } catch (error) {
      setJobMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    cancelBackgroundShellJob,
    jobMessage,
    refreshRuntimeShellJobs,
    runtimeShellJobs,
    startBackgroundShellJob
  };
}

function promptToShellCommand(prompt: string) {
  return prompt
    .trim()
    .replace(/^(运行|执行|run)\s+/i, "")
    .trim();
}

function isLiveShellJob(job: ShellJobRecord) {
  return job.status === "running" || job.status === "canceling";
}
