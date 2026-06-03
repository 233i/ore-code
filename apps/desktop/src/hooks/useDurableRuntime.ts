import { useRef, type MutableRefObject } from "react";
import {
  AutomationManager,
  createDurableTaskSystemPrompt,
  createProjectContextPrompt,
  DurableTaskExecutor,
  DurableTaskManager,
  MockLlmClient,
  type LlmClient
} from "@ore-code/agent-core";
import type { createRuntimeArtifactStore } from "../services/artifactStore";
import { loadOreCodeInstructions, type OreCodeInstructions } from "../services/oreCodeInstructions";
import type { ProviderConfig } from "../services/oreCodeConfig";
import { createRuntimeAutomationStore, createRuntimeDurableTaskStore } from "../services/durableRuntimeStore";
import { createRuntimeFileHost } from "../services/fileHost";
import { detectRuntimeOperatingSystem } from "../services/runtimePlatform";
import { fallbackDeepSeekProvider } from "./useProviderConfig";
import { createDesktopToolRegistry } from "./createDesktopToolRegistry";

export function useDurableRuntime(input: {
  artifactStore: MutableRefObject<ReturnType<typeof createRuntimeArtifactStore>>;
  createConfiguredProviderClient: (reason: string) => Promise<LlmClient | null>;
  deepSeekBaseUrl: string;
  deepSeekModel: string;
  effectiveProviderConfig: ProviderConfig | null;
  provider: string;
  resolveProviderApiKey: (providerConfig: ProviderConfig) => Promise<string | null>;
  workspacePath: string;
}) {
  const durableTaskManager = useRef(new DurableTaskManager(createRuntimeDurableTaskStore()));
  const automationManager = useRef(new AutomationManager({
    store: createRuntimeAutomationStore(),
    taskManager: durableTaskManager.current
  }));
  const durableTaskExecutorRunning = useRef(false);

  async function runDurableTaskExecutorTick() {
    if (durableTaskExecutorRunning.current) {
      return;
    }

    durableTaskExecutorRunning.current = true;
    try {
      const instructions = await loadOreCodeInstructions({
        fileHost: createRuntimeFileHost(),
        workspacePath: input.workspacePath
      });
      const operatingSystem = detectRuntimeOperatingSystem();
      for (let i = 0; i < 3; i += 1) {
        const executor = new DurableTaskExecutor(durableTaskManager.current, {
          artifacts: { store: input.artifactStore.current },
          model: resolveBackgroundModel({
            provider: input.provider,
            effectiveProviderConfig: input.effectiveProviderConfig,
            deepSeekModel: input.deepSeekModel,
            deepSeekBaseUrl: input.deepSeekBaseUrl
          }),
          workspacePath: input.workspacePath,
          mode: "agent",
          trustedWorkspace: false,
          createClient: createBackgroundLlmClient,
          createRegistry: () => createBackgroundToolRegistry(instructions, operatingSystem),
          projectContext: (_task, toolContext) => createProjectContextPrompt({
            workspacePath: toolContext.workspacePath,
            mode: toolContext.mode,
            operatingSystem,
            projectInstructions: instructions.projectInstructions,
            userInstructions: instructions.userInstructions
          }),
          systemPrompt: (task, toolContext, registry) => createDurableTaskSystemPrompt({
            workspacePath: toolContext.workspacePath,
            mode: toolContext.mode,
            operatingSystem,
            projectInstructions: instructions.projectInstructions,
            userInstructions: instructions.userInstructions,
            tools: registry.list(),
            durableTaskNote: `You are executing durable task ${task.id}. Background execution cannot receive interactive approvals, so avoid side-effectful tools unless the task already has explicit non-interactive support.`
          })
        });
        const result = await executor.runNext();
        if (!result.ran) {
          break;
        }
      }
    } finally {
      durableTaskExecutorRunning.current = false;
    }
  }

  async function createBackgroundLlmClient(): Promise<LlmClient> {
    if (input.provider === "mock") {
      return new MockLlmClient([
        { type: "assistant_delta", text: "后台持久任务模拟执行完成。" },
        { type: "done" }
      ]);
    }

    const client = await input.createConfiguredProviderClient("durable task execution");
    if (!client) {
      throw new Error("Provider API Key is required for durable task execution.");
    }
    return client;
  }

  async function createBackgroundToolRegistry(
    instructions?: OreCodeInstructions,
    operatingSystem = detectRuntimeOperatingSystem()
  ) {
    return createDesktopToolRegistry({
      activeModel: resolveBackgroundModel({
        provider: input.provider,
        effectiveProviderConfig: input.effectiveProviderConfig,
        deepSeekModel: input.deepSeekModel,
        deepSeekBaseUrl: input.deepSeekBaseUrl
      }),
      artifactStore: input.artifactStore.current,
      automationManager: automationManager.current,
      deepSeekBaseUrl: input.deepSeekBaseUrl,
      deepSeekModel: input.deepSeekModel,
      durableTaskManager: durableTaskManager.current,
      effectiveProviderConfig: input.effectiveProviderConfig,
      instructions,
      operatingSystem,
      provider: input.provider,
      resolveProviderApiKey: input.resolveProviderApiKey,
      workspacePath: input.workspacePath
    });
  }

  return {
    durableTaskManager,
    automationManager,
    runDurableTaskExecutorTick
  };
}

function resolveBackgroundModel(input: {
  provider: string;
  effectiveProviderConfig: ProviderConfig | null;
  deepSeekModel: string;
  deepSeekBaseUrl: string;
}) {
  if (input.provider === "mock") {
    return "mock";
  }

  return (input.effectiveProviderConfig ?? fallbackDeepSeekProvider(input.deepSeekModel, input.deepSeekBaseUrl)).model;
}
