import { useState, type MutableRefObject } from "react";
import type {
  AutomationManager,
  AutomationRecord,
  DurableTaskManager,
  DurableTaskSnapshot
} from "@ore-code/agent-core";

export function useAutomationActions(input: {
  automationManager: MutableRefObject<AutomationManager>;
  durableTaskManager: MutableRefObject<DurableTaskManager>;
  runDurableTaskExecutorTick: () => Promise<void>;
  workspacePath: string;
}) {
  const [durableTasks, setDurableTasks] = useState<DurableTaskSnapshot[]>([]);
  const [automations, setAutomations] = useState<AutomationRecord[]>([]);
  const [automationMessage, setAutomationMessage] = useState<string | null>(null);
  const [automationBusy, setAutomationBusy] = useState(false);

  async function refreshAutomationWorkspace(nextMessage?: string) {
    setAutomationBusy(true);
    try {
      await Promise.all([
        input.durableTaskManager.current.reload(),
        input.automationManager.current.reload()
      ]);
      const [nextTasks, nextAutomations] = await Promise.all([
        input.durableTaskManager.current.list({ workspacePath: input.workspacePath }),
        input.automationManager.current.list(100)
      ]);
      setDurableTasks(nextTasks);
      setAutomations(nextAutomations);
      setAutomationMessage(nextMessage ?? `${nextAutomations.length} 个自动化，${nextTasks.length} 个持久任务。`);
    } catch (error) {
      setAutomationMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAutomationBusy(false);
    }
  }

  async function createAutomation(inputValue: { name: string; prompt: string; rrule: string; paused?: boolean }) {
    setAutomationBusy(true);
    try {
      const created = await input.automationManager.current.create({
        name: inputValue.name,
        prompt: inputValue.prompt,
        rrule: inputValue.rrule,
        paused: inputValue.paused,
        cwds: input.workspacePath === "." ? [] : [input.workspacePath]
      });
      await refreshAutomationWorkspace(`已创建自动化：${created.name}`);
    } catch (error) {
      setAutomationMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAutomationBusy(false);
    }
  }

  async function runAutomationNow(id: string) {
    setAutomationBusy(true);
    try {
      const result = await input.automationManager.current.runNow(id, input.workspacePath);
      await refreshAutomationWorkspace(result.taskCreated ? "已创建一次后台任务。" : "已记录自动化运行。");
    } catch (error) {
      setAutomationMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAutomationBusy(false);
    }
  }

  async function runDueAutomations() {
    setAutomationBusy(true);
    try {
      const runs = await input.automationManager.current.runDue(input.workspacePath);
      await input.runDurableTaskExecutorTick();
      await refreshAutomationWorkspace(runs.length > 0 ? `已处理 ${runs.length} 个到期自动化。` : "当前没有到期自动化。");
    } catch (error) {
      setAutomationMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAutomationBusy(false);
    }
  }

  async function toggleAutomation(id: string, status: AutomationRecord["status"]) {
    setAutomationBusy(true);
    try {
      const updated = status === "active"
        ? await input.automationManager.current.pause(id)
        : await input.automationManager.current.resume(id);
      await refreshAutomationWorkspace(`${updated.name} 已${updated.status === "active" ? "恢复" : "暂停"}。`);
    } catch (error) {
      setAutomationMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAutomationBusy(false);
    }
  }

  async function deleteAutomation(id: string) {
    if (!window.confirm("删除这个自动化及其运行记录？")) {
      return;
    }
    setAutomationBusy(true);
    try {
      const deleted = await input.automationManager.current.delete(id);
      await refreshAutomationWorkspace(`已删除自动化：${deleted.name}`);
    } catch (error) {
      setAutomationMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAutomationBusy(false);
    }
  }

  async function cancelTask(id: string) {
    setAutomationBusy(true);
    try {
      const canceled = await input.durableTaskManager.current.cancel(id);
      await refreshAutomationWorkspace(`已取消任务：${canceled.title}`);
    } catch (error) {
      setAutomationMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAutomationBusy(false);
    }
  }

  async function retryTask(id: string) {
    setAutomationBusy(true);
    try {
      const source = await input.durableTaskManager.current.read(id);
      const created = await input.durableTaskManager.current.create({
        title: truncateTaskTitle(`重试：${source.title}`),
        prompt: buildRetryPrompt(source),
        sourceThreadId: source.sourceThreadId,
        workspacePath: source.workspacePath ?? input.workspacePath
      });
      await input.runDurableTaskExecutorTick();
      await refreshAutomationWorkspace(`已创建重试任务：${created.title}`);
    } catch (error) {
      setAutomationMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAutomationBusy(false);
    }
  }

  async function continueTask(id: string) {
    setAutomationBusy(true);
    try {
      const source = await input.durableTaskManager.current.read(id);
      const created = await input.durableTaskManager.current.create({
        title: truncateTaskTitle(`继续：${source.title}`),
        prompt: buildContinuePrompt(source),
        sourceThreadId: source.sourceThreadId,
        workspacePath: source.workspacePath ?? input.workspacePath
      });
      await input.runDurableTaskExecutorTick();
      await refreshAutomationWorkspace(`已创建继续任务：${created.title}`);
    } catch (error) {
      setAutomationMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAutomationBusy(false);
    }
  }

  return {
    automationBusy,
    automationMessage,
    automations,
    cancelTask,
    continueTask,
    createAutomation,
    deleteAutomation,
    durableTasks,
    refreshAutomationWorkspace,
    retryTask,
    runAutomationNow,
    runDueAutomations,
    toggleAutomation
  };
}

function truncateTaskTitle(value: string) {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function buildRetryPrompt(task: DurableTaskSnapshot) {
  return [
    `重试 durable task ${task.id}：${task.title}`,
    "",
    "要求：重新检查当前代码状态，不要假设上次执行仍然有效；先写入/更新 checklist，测试、构建、打包命令必须记录为 gate；最终必须说明改了什么、跑了什么、结果如何。",
    "",
    "原始目标：",
    task.prompt,
    "",
    "上次执行摘要：",
    summarizeTaskForFollowUp(task)
  ].join("\n");
}

function buildContinuePrompt(task: DurableTaskSnapshot) {
  return [
    `继续 durable task ${task.id}：${task.title}`,
    "",
    "要求：基于现有结果继续推进，不重复已经完成的 checklist；必要时补充 checklist；测试、构建、打包命令必须记录为 gate；最终必须说明改了什么、跑了什么、结果如何。",
    "",
    "原始目标：",
    task.prompt,
    "",
    "当前任务状态：",
    summarizeTaskForFollowUp(task)
  ].join("\n");
}

function summarizeTaskForFollowUp(task: DurableTaskSnapshot) {
  const lines = [
    `状态：${task.status}`,
    task.output ? `输出：${task.output}` : "",
    task.error ? `错误：${task.error}` : ""
  ].filter(Boolean);

  if (task.checklist.length > 0) {
    lines.push("Checklist：");
    for (const item of task.checklist) {
      lines.push(`- ${item.status}：${item.content}`);
    }
  }

  if (task.gates.length > 0) {
    lines.push("验证 gates：");
    for (const gate of task.gates) {
      lines.push(`- ${gate.status}：${gate.name}${gate.command ? ` (${gate.command})` : ""} -> ${gate.summary}`);
    }
  }

  if (task.artifacts.length > 0) {
    lines.push("Artifacts：");
    for (const artifact of task.artifacts) {
      lines.push(`- ${artifact.summary}：${artifact.artifactId}`);
    }
  }

  if (task.threadId) {
    lines.push(`关联会话：${task.threadId}`);
  }

  return lines.join("\n");
}
