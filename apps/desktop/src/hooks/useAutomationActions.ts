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
        input.durableTaskManager.current.list(),
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

  return {
    automationBusy,
    automationMessage,
    automations,
    createAutomation,
    deleteAutomation,
    durableTasks,
    refreshAutomationWorkspace,
    runAutomationNow,
    runDueAutomations,
    toggleAutomation
  };
}
