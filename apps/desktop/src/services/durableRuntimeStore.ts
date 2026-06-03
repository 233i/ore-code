import { invoke } from "@tauri-apps/api/core";
import type { AutomationState, DurableTaskState } from "@ore-code/agent-core";
import { isTauriRuntime } from "./fileHost";

const DURABLE_TASK_STORAGE_KEY = "ore-code.durableTasks.v1";
const AUTOMATION_STORAGE_KEY = "ore-code.automations.v1";

export function createRuntimeDurableTaskStore() {
  if (isTauriRuntime()) {
    return {
      async load(): Promise<DurableTaskState | null> {
        const state = await invoke<DurableTaskState>("durable_task_state_load");
        return Array.isArray(state.tasks) ? state : null;
      },
      async save(state: DurableTaskState) {
        await invoke("durable_task_state_save", { state });
      }
    };
  }

  return createBrowserDurableTaskStore();
}

export function createRuntimeAutomationStore() {
  if (isTauriRuntime()) {
    return {
      async load(): Promise<AutomationState | null> {
        const state = await invoke<AutomationState>("automation_state_load");
        return Array.isArray(state.automations) && Array.isArray(state.runs) ? state : null;
      },
      async save(state: AutomationState) {
        await invoke("automation_state_save", { state });
      }
    };
  }

  return createBrowserAutomationStore();
}

function createBrowserDurableTaskStore() {
  return {
    async load(): Promise<DurableTaskState | null> {
      if (typeof window === "undefined") {
        return null;
      }
      const raw = window.localStorage.getItem(DURABLE_TASK_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      try {
        const parsed = JSON.parse(raw) as DurableTaskState;
        return Array.isArray(parsed.tasks) ? parsed : null;
      } catch {
        return null;
      }
    },
    async save(state: DurableTaskState) {
      if (typeof window === "undefined") {
        return;
      }
      window.localStorage.setItem(DURABLE_TASK_STORAGE_KEY, JSON.stringify(state));
    }
  };
}

function createBrowserAutomationStore() {
  return {
    async load(): Promise<AutomationState | null> {
      if (typeof window === "undefined") {
        return null;
      }
      const raw = window.localStorage.getItem(AUTOMATION_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      try {
        const parsed = JSON.parse(raw) as AutomationState;
        return Array.isArray(parsed.automations) && Array.isArray(parsed.runs) ? parsed : null;
      } catch {
        return null;
      }
    },
    async save(state: AutomationState) {
      if (typeof window === "undefined") {
        return;
      }
      window.localStorage.setItem(AUTOMATION_STORAGE_KEY, JSON.stringify(state));
    }
  };
}
