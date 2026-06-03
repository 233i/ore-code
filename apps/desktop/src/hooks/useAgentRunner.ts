import { useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  AgentEngine,
  buildRuntimeContextFromMessages,
  buildProjectDeltaEventBody,
  createImmutablePrefixSnapshot,
  createLazyContextEventBody,
  createCodingSystemPrompt,
  createProjectContextPrompt,
  DEEPSEEK_V4_PRO_MODEL,
  resolveDeepSeekTurnModel,
  ModelMessageLedger,
  resolvePrefixInvalidationReason,
  shouldReuseImmutablePrefixSnapshot,
  ToolProfileEscalationError,
  type AutomationManager,
  type AssembledRequest,
  type CacheWarmupRecord,
  type DurableTaskManager,
  type ImmutablePrefixSnapshot,
  type LlmClient,
  type PrefixInvalidationReason,
  type DeepSeekModelMode,
  type DeepSeekTurnClassifierResult,
  type ResolvedDeepSeekTurnModel
} from "@ore-code/agent-core";
import {
  assessCommandRisk,
  resolveRunTestsCommand,
  type CommandRiskAssessment
} from "@ore-code/tools";
import type { ApprovalDecision, InteractionDecision, RuntimeEvent, ToolCall } from "@ore-code/protocol";
import {
  createChangeTrackingFileHost,
  type TrackedFileChange
} from "../features/changes/changeLedger";
import type { createRuntimeArtifactStore } from "../services/artifactStore";
import { createRuntimeFileHost } from "../services/fileHost";
import type { McpToolSnapshot } from "../services/mcpHost";
import { loadOreCodeInstructions } from "../services/oreCodeInstructions";
import { buildProjectIndexContext, type ProjectIndexContext } from "../services/projectIndex";
import { detectRuntimeOperatingSystem } from "../services/runtimePlatform";
import { snapshotFromTrackedChanges } from "../services/turnSnapshotStore";
import type { createTurnSnapshotStore } from "../services/turnSnapshotStore";
import type { ComposerAttachment } from "../ui/composerTypes";
import {
  autoReviewDecisionForCall,
  resolvePermissionPreset,
  type AppMode,
  type PermissionPreset
} from "../ui/permissionPreset";
import { parseSlashCommand, type SlashCommand } from "../ui/slashCommands";
import { renderSkillPromptFromCommand } from "../services/skillRegistry";
import { fallbackDeepSeekProvider, type CreateLlmClientOptions, type Provider } from "./useProviderConfig";
import type { ProviderConfig } from "../services/oreCodeConfig";
import type { ChangeGroup } from "../features/changes/changeGroups";
import { createDesktopToolRegistry, isDesktopToolAllowedForProfile } from "./createDesktopToolRegistry";
import {
  classifyDeepSeekTurnWithFlashCached,
  type DeepSeekTurnClassifierCache
} from "./deepSeekTurnClassifier";
import {
  runDeepSeekProOrchestratedExploration,
  shouldUseDeepSeekProOrchestration
} from "./deepSeekProOrchestrator";

type ActiveTurnSkill = { id: string; name: string } | null;
type InteractionRequestEvent = Extract<RuntimeEvent, { type: "interaction_requested" }>;
type ModelLedgerRecord = { ledger: ModelMessageLedger; eventCount: number; lastSeq: number; eventHash: string };
const INTERACTION_CONTINUE_PROMPT = "继续，根据用户刚才的选择推进计划。";
const ENABLE_PREFIX_INVARIANT_ASSERT = import.meta.env.DEV || import.meta.env.MODE === "test";

export type UseAgentRunnerInput = {
  artifactStore: MutableRefObject<ReturnType<typeof createRuntimeArtifactStore>>;
  attachments: ComposerAttachment[];
  automationManager: MutableRefObject<AutomationManager>;
  availableSlashCommands: SlashCommand[];
  createConfiguredProviderClient: (reason: string, options?: CreateLlmClientOptions) => Promise<LlmClient | null>;
  createLlmClient: (prompt: string, options?: CreateLlmClientOptions) => Promise<LlmClient | null>;
  deepSeekBaseUrl: string;
  deepSeekModel: string;
  deepSeekModelMode: DeepSeekModelMode;
  durableTaskManager: MutableRefObject<DurableTaskManager>;
  effectiveProviderConfig: ProviderConfig | null;
  events: RuntimeEvent[];
  executeLocalSlashCommand: (input: string) => Promise<boolean>;
  enableCacheWarmup: boolean;
  includeIdeContext: boolean;
  lazyContextIndex?: string;
  mode: AppMode;
  onDeepSeekModelResolved?: (resolution: ResolvedDeepSeekTurnModel | null) => void;
  permissionPreset: PermissionPreset;
  persistSession: (threadId: string, events: RuntimeEvent[], options?: { silent?: boolean }) => Promise<void>;
  provider: Provider;
  resolveProviderApiKey: (providerConfig: ProviderConfig) => Promise<string | null>;
  setActiveTurnSkill: Dispatch<SetStateAction<ActiveTurnSkill>>;
  setAttachments: Dispatch<SetStateAction<ComposerAttachment[]>>;
  setChangeDiffPreview: Dispatch<SetStateAction<string>>;
  setChangesMessage: Dispatch<SetStateAction<string | null>>;
  setClearedChangeTurnId: Dispatch<SetStateAction<string | null>>;
  setEvents: Dispatch<SetStateAction<RuntimeEvent[]>>;
  setMcpMessage: Dispatch<SetStateAction<string | null>>;
  setMcpSnapshot: Dispatch<SetStateAction<McpToolSnapshot | null>>;
  setPromptText: Dispatch<SetStateAction<string>>;
  setProviderError: Dispatch<SetStateAction<string | null>>;
  setSelectedChangeGroup: Dispatch<SetStateAction<ChangeGroup>>;
  setSelectedChangePath: Dispatch<SetStateAction<string | null>>;
  setSessionMessage: Dispatch<SetStateAction<string | null>>;
  setTaskFileChanges: Dispatch<SetStateAction<TrackedFileChange[]>>;
  snapshotStore: ReturnType<typeof createTurnSnapshotStore>;
  taskFileChangesRef: MutableRefObject<TrackedFileChange[]>;
  threadId: string;
  workspacePath: string;
};

export function useAgentRunner(input: UseAgentRunnerInput) {
  const [isRunning, setIsRunning] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ToolCall | null>(null);
  const [pendingInteraction, setPendingInteraction] = useState<InteractionRequestEvent | null>(null);
  const [sessionApprovalCacheCount, setSessionApprovalCacheCount] = useState(0);
  const approvalResolver = useRef<((decision: ApprovalDecision | undefined) => void) | null>(null);
  const interactionResolver = useRef<((decision: InteractionDecision | undefined) => void) | null>(null);
  const runAbortController = useRef<AbortController | null>(null);
  const cacheWarmupRecords = useRef(new Map<string, CacheWarmupRecord>());
  const immutablePrefixSnapshots = useRef(new Map<string, ImmutablePrefixSnapshot>());
  const assembledRequestSnapshots = useRef(new Map<string, AssembledRequest>());
  const modelMessageLedgers = useRef(new Map<string, ModelLedgerRecord>());
  const deepSeekClassifierCache = useRef<DeepSeekTurnClassifierCache>(new Map());
  const sessionApprovalCache = useRef(new Map<string, ApprovalDecision>());
  const visibleThreadIdRef = useRef(input.threadId);
  const pendingApprovalRisk = useMemo(() => getShellApprovalRisk(pendingApproval), [pendingApproval]);
  visibleThreadIdRef.current = input.threadId;

  async function runAgentTurn(prompt = "", options: {
    forceDeepSeekModelMode?: Exclude<DeepSeekModelMode, "auto">;
    priorEvents?: RuntimeEvent[];
    skipLocalRouting?: boolean;
    visibleUserEvent?: Extract<RuntimeEvent, { type: "user_message" }>;
  } = {}) {
    if (isRunning || runAbortController.current) {
      stopAgentTurn();
      return;
    }

    let userPrompt = prompt.trim() || "列出当前工作区";
    const skillPrompt = resolveSkillPromptFromSlashInput(userPrompt, input.availableSlashCommands);
    if (skillPrompt) {
      userPrompt = skillPrompt.prompt;
      input.setActiveTurnSkill(skillPrompt.skill);
    } else if (await input.executeLocalSlashCommand(userPrompt)) {
      return;
    } else {
      input.setActiveTurnSkill(null);
    }

    const permission = resolvePermissionPreset(input.permissionPreset, input.mode === "plan");
    const operatingSystem = detectRuntimeOperatingSystem();
    const priorEvents = options.priorEvents ?? input.events;
    const activeThreadId = input.threadId;
    const setActiveSessionMessage = (message: string | null) => {
      if (visibleThreadIdRef.current === activeThreadId) {
        input.setSessionMessage(message);
      }
    };

    const preliminaryModelResolution = resolveActiveModel({
      provider: input.provider,
      effectiveProviderConfig: input.effectiveProviderConfig,
      deepSeekModel: input.deepSeekModel,
      deepSeekBaseUrl: input.deepSeekBaseUrl,
      deepSeekModelMode: options.forceDeepSeekModelMode ?? input.deepSeekModelMode,
      hasAttachments: input.attachments.length > 0,
      prompt: userPrompt,
      priorEvents,
      contextTextChars: userPrompt.length
    });
    if (!options.skipLocalRouting && preliminaryModelResolution.route === "local" && preliminaryModelResolution.localResponse) {
      input.onDeepSeekModelResolved?.(input.provider === "deepseek" ? preliminaryModelResolution.deepSeek ?? null : null);
      await appendLocalAssistantTurn({
        events: priorEvents,
        persistSession: input.persistSession,
        response: preliminaryModelResolution.localResponse,
        setAttachments: input.setAttachments,
        setEvents: input.setEvents,
        setPromptText: input.setPromptText,
        setProviderError: input.setProviderError,
        setSessionMessage: input.setSessionMessage,
        threadId: input.threadId,
        userPrompt
      });
      return;
    }

    const turnId = options.visibleUserEvent?.turnId ?? crypto.randomUUID();
    const earlyUserMessageEvent: Extract<RuntimeEvent, { type: "user_message" }> = options.visibleUserEvent ?? {
      id: crypto.randomUUID(),
      seq: nextSeq(priorEvents),
      threadId: activeThreadId,
      turnId,
      createdAt: new Date().toISOString(),
      type: "user_message",
      text: userPrompt
    };
    let nextEvents: RuntimeEvent[] = [...priorEvents, earlyUserMessageEvent];
    if (visibleThreadIdRef.current === activeThreadId) {
      input.setEvents(nextEvents);
    }
    void input.persistSession(activeThreadId, nextEvents, { silent: true });
    input.setPromptText("");
    input.setAttachments([]);

    const runController = new AbortController();
    runAbortController.current = runController;
    setIsRunning(true);
    setPendingApproval(null);
    input.setProviderError(null);
    setActiveSessionMessage("正在准备请求。");

    try {
      input.taskFileChangesRef.current = [];
      input.setTaskFileChanges([]);
      input.setClearedChangeTurnId(null);
      const fileHost = createChangeTrackingFileHost(createRuntimeFileHost(), (change) => {
        if (visibleThreadIdRef.current !== activeThreadId) {
          return;
        }
        input.taskFileChangesRef.current = [...input.taskFileChangesRef.current, change];
        input.setTaskFileChanges(input.taskFileChangesRef.current);
        input.setSelectedChangePath((current) => current ?? change.path);
        input.setSelectedChangeGroup("turn");
        input.setChangeDiffPreview(change.diff);
      });
      const projectIndex = await safeBuildProjectIndexContext({
        fileHost,
        priorEvents,
        prompt: userPrompt,
        trackedChanges: input.taskFileChangesRef.current,
        workspacePath: input.workspacePath
      });
      if (runController.signal.aborted) {
        return;
      }
      let llmPrompt = composePromptWithComposerContext(userPrompt, {
        attachments: input.attachments,
        codebaseContext: projectIndex.block,
        includeIdeContext: input.includeIdeContext,
        workspacePath: input.workspacePath
      });
      const modelPreflight = resolveActiveModel({
        provider: input.provider,
        effectiveProviderConfig: input.effectiveProviderConfig,
        deepSeekModel: input.deepSeekModel,
        deepSeekBaseUrl: input.deepSeekBaseUrl,
        deepSeekModelMode: options.forceDeepSeekModelMode ?? input.deepSeekModelMode,
        hasAttachments: input.attachments.length > 0,
        prompt: userPrompt,
        priorEvents,
        contextTextChars: llmPrompt.length
      });
      const classifier = shouldRunDeepSeekFlashClassifier(modelPreflight)
        ? await classifyDeepSeekTurnWithFlashCached({
          cache: deepSeekClassifierCache.current,
          contextTextChars: llmPrompt.length,
          createConfiguredProviderClient: input.createConfiguredProviderClient,
          hasAttachments: input.attachments.length > 0,
          prompt: userPrompt,
          signal: runController.signal
        })
        : undefined;
      if (runController.signal.aborted) {
        return;
      }
      const modelResolution = classifier === undefined
        ? modelPreflight
        : resolveActiveModel({
          provider: input.provider,
          effectiveProviderConfig: input.effectiveProviderConfig,
          deepSeekModel: input.deepSeekModel,
          deepSeekBaseUrl: input.deepSeekBaseUrl,
          deepSeekModelMode: options.forceDeepSeekModelMode ?? input.deepSeekModelMode,
          hasAttachments: input.attachments.length > 0,
          prompt: userPrompt,
          priorEvents,
          classifier,
          contextTextChars: llmPrompt.length
        });
      const activeModel = modelResolution.resolvedModel;
      if (!activeModel) {
        return;
      }
      const toolProfile = modelResolution.deepSeek?.toolProfile ?? "full";
      if (shouldRunDeepSeekProOrchestration({
        contextTextChars: llmPrompt.length,
        modelResolution,
        priorEvents,
        provider: input.provider,
        relevantFileCount: projectIndex.relevantFiles.length,
        userPrompt
      })) {
        setActiveSessionMessage("Pro 正在规划 Flash 只读探索。");
        const readonlyRegistry = await createDesktopToolRegistry({
          activeModel: DEEPSEEK_V4_PRO_MODEL,
          artifactStore: input.artifactStore.current,
          deepSeekBaseUrl: input.deepSeekBaseUrl,
          deepSeekModel: input.deepSeekModel,
          effectiveProviderConfig: input.effectiveProviderConfig,
          enableInteractionTool: false,
          enableMcpTools: false,
          enableNoteTool: false,
          enableRlmTool: false,
          enableSubagentTools: false,
          fileHost,
          operatingSystem,
          provider: input.provider,
          resolveProviderApiKey: input.resolveProviderApiKey,
          toolProfile: "readonly",
          workspacePath: input.workspacePath
        });
        if (runController.signal.aborted) {
          return;
        }
        const orchestration = await runDeepSeekProOrchestratedExploration({
          artifactStore: input.artifactStore.current,
          codebaseContext: projectIndex.block,
          createConfiguredProviderClient: input.createConfiguredProviderClient,
          readonlyRegistry,
          signal: runController.signal,
          toolContext: {
            workspacePath: input.workspacePath,
            mode: permission.mode,
            trustedWorkspace: permission.trustedWorkspace
          },
          userPrompt
        });
        if (runController.signal.aborted) {
          return;
        }
        if (orchestration) {
          llmPrompt = appendProOrchestrationContext(llmPrompt, orchestration.contextBlock);
          setActiveSessionMessage(`Flash 已完成 ${orchestration.rlm.okCount}/${orchestration.rlm.promptCount} 个只读探索，交给 Pro 编辑验证。`);
        }
      }
      input.onDeepSeekModelResolved?.(input.provider === "deepseek" ? modelResolution.deepSeek ?? null : null);
      setActiveSessionMessage("正在连接模型。");
      const llm = await input.createLlmClient(userPrompt, { modelOverride: activeModel });
      if (!llm || runController.signal.aborted) {
        return;
      }
      const instructions = await loadOreCodeInstructions({
        fileHost,
        workspacePath: input.workspacePath
      });
      if (runController.signal.aborted) {
        return;
      }
      const registry = await createDesktopToolRegistry({
        activeModel,
        artifactStore: input.artifactStore.current,
        automationManager: input.automationManager.current,
        createConfiguredProviderClient: input.createConfiguredProviderClient,
        deepSeekBaseUrl: input.deepSeekBaseUrl,
        deepSeekModel: input.deepSeekModel,
        durableTaskManager: input.durableTaskManager.current,
        effectiveProviderConfig: input.effectiveProviderConfig,
        enableInteractionTool: permission.mode === "plan",
        enableMcpTools: true,
        enableNoteTool: true,
        enableSubagentTools: true,
        fileHost,
        instructions,
        operatingSystem,
        onMcpMessage: input.setMcpMessage,
        onMcpSnapshot: input.setMcpSnapshot,
        provider: input.provider,
        resolveProviderApiKey: input.resolveProviderApiKey,
        toolProfile,
        workspacePath: input.workspacePath
      });
      if (runController.signal.aborted) {
        return;
      }

    const modelLedgerRecord = resolveModelMessageLedger(modelMessageLedgers.current, activeThreadId, priorEvents);
    let earlyUserMessageSynced = false;
    const syncEarlyUserMessageToLedger = () => {
      if (earlyUserMessageSynced) {
        return;
      }
      earlyUserMessageSynced = true;
      syncModelMessageLedgerRecord(modelLedgerRecord, earlyUserMessageEvent, nextEvents.length);
    };
    let pendingInteractionEvent: InteractionRequestEvent | null = null;
    const appendRuntimeEvent = (event: RuntimeEvent) => {
      const sequencedEvent = { ...event, seq: nextSeq(nextEvents) } as RuntimeEvent;
      nextEvents = [...nextEvents, sequencedEvent];
      syncModelMessageLedgerRecord(modelLedgerRecord, sequencedEvent, nextEvents.length);
      if (sequencedEvent.type === "interaction_requested") {
        pendingInteractionEvent = sequencedEvent;
        if (visibleThreadIdRef.current === activeThreadId) {
          setPendingInteraction(sequencedEvent);
        }
      }
      if (sequencedEvent.type === "interaction_decided" && pendingInteractionEvent?.requestId === sequencedEvent.requestId) {
        pendingInteractionEvent = null;
        if (visibleThreadIdRef.current === activeThreadId) {
          setPendingInteraction(null);
        }
      }
      if (visibleThreadIdRef.current === activeThreadId) {
        input.setEvents(nextEvents);
      }
    };
    const runtimeContext = buildRuntimeContextFromMessages(modelLedgerRecord.ledger.messages(), {
      checkpoint: "auto",
      model: activeModel
    });
    const checkpointApplied = runtimeContext.checkpoint.status === "applied";
    const codebaseContextEvent = buildCodebaseContextEvent(projectIndex);
    if (runtimeContext.checkpointEvent) {
      appendRuntimeEvent({
        id: crypto.randomUUID(),
        seq: nextSeq(nextEvents),
        threadId: activeThreadId,
        turnId,
        createdAt: new Date().toISOString(),
        ...runtimeContext.checkpointEvent
      } as RuntimeEvent);
    }
    syncEarlyUserMessageToLedger();
    if (skillPrompt?.lazyContext) {
      appendRuntimeEvent({
        id: crypto.randomUUID(),
        seq: nextSeq(nextEvents),
        threadId: activeThreadId,
        turnId,
        createdAt: new Date().toISOString(),
        ...createLazyContextEventBody(skillPrompt.lazyContext)
      } as RuntimeEvent);
    }
    appendRuntimeEvent({
      id: crypto.randomUUID(),
      seq: nextSeq(nextEvents),
      threadId: activeThreadId,
      turnId,
      createdAt: new Date().toISOString(),
      ...codebaseContextEvent
    } as RuntimeEvent);
    let sideSnapshotId: string | undefined;
    let sideGitCommit: string | undefined;
    let sideGitBranch: string | undefined;
    let escalateToPro: ToolProfileEscalationError | null = null;
    const systemPrompt = createCodingSystemPrompt({
      workspacePath: input.workspacePath,
      mode: permission.mode,
      operatingSystem,
      projectInstructions: instructions.projectInstructions,
      userInstructions: instructions.userInstructions,
      tools: registry.list()
    });
    const projectContext = createProjectContextPrompt({
      lazyContextIndex: input.lazyContextIndex,
      workspacePath: input.workspacePath,
      mode: permission.mode,
      operatingSystem,
      projectInstructions: instructions.projectInstructions,
      userInstructions: instructions.userInstructions
    });
    const nextImmutablePrefix = createImmutablePrefixSnapshot({
      provider: input.provider,
      model: activeModel,
      workspacePath: input.workspacePath,
      mode: permission.mode,
      systemPrompt,
      projectContext,
      toolSpecs: registry.list()
    });
    const previousImmutablePrefix = immutablePrefixSnapshots.current.get(activeThreadId);
    const previousAssembledRequest = assembledRequestSnapshots.current.get(activeThreadId);
    const immutablePrefix = shouldReuseImmutablePrefixSnapshot(previousImmutablePrefix, nextImmutablePrefix)
      ? previousImmutablePrefix
      : nextImmutablePrefix;
    if (immutablePrefix === nextImmutablePrefix) {
      immutablePrefixSnapshots.current.set(activeThreadId, nextImmutablePrefix);
      const reason = resolvePrefixInvalidationReason(previousImmutablePrefix, nextImmutablePrefix);
      appendRuntimeEvent({
        id: crypto.randomUUID(),
        seq: nextSeq(nextEvents),
        threadId: activeThreadId,
        turnId,
        createdAt: new Date().toISOString(),
        type: "prefix_invalidated",
        reason,
        previousFingerprint: previousImmutablePrefix?.fingerprint,
        nextFingerprint: nextImmutablePrefix.fingerprint,
        coreHash: nextImmutablePrefix.coreHash,
        projectHash: nextImmutablePrefix.projectHash,
        toolHash: nextImmutablePrefix.toolHash,
        message: prefixInvalidationMessage(reason)
      });
    }

    setActiveSessionMessage(null);
    if (runController.signal.aborted) {
      return;
    }

    if (toolProfile !== "readonly") {
      try {
        const sideSnapshot = await input.snapshotStore.saveSideSnapshot({
          label: "pre-turn",
          snapshotId: createSideSnapshotId(turnId, "pre"),
          threadId: activeThreadId,
          turnId,
          workspacePath: input.workspacePath
        });
        sideSnapshotId = sideSnapshot?.id;
        sideGitCommit = sideSnapshot?.sideGitCommit;
        sideGitBranch = sideSnapshot?.sideGitBranch;
      } catch (error) {
        input.setChangesMessage(`保存 side snapshot 失败：${messageFromUnknown(error)}`);
      }
    }
    if (runController.signal.aborted) {
      return;
    }

    const engine = new AgentEngine(llm, {
      artifacts: {
        store: input.artifactStore.current
      },
      cacheWarmup: {
        enabled: input.enableCacheWarmup,
        store: {
          get: (key) => cacheWarmupRecords.current.get(key),
          set: (record) => {
            cacheWarmupRecords.current.set(record.key, record);
          }
        }
      },
      provider: input.provider,
      model: activeModel,
      immutablePrefix,
      requestMonitor: {
        previous: assembledRequestSnapshots.current.get(activeThreadId),
        assertAppendOnlyPrefix: ENABLE_PREFIX_INVARIANT_ASSERT && immutablePrefix === previousImmutablePrefix && !checkpointApplied,
        onAssembled: (request) => {
          if (ENABLE_PREFIX_INVARIANT_ASSERT) {
            assembledRequestSnapshots.current.set(activeThreadId, request);
          }
        }
      },
      projectContext,
      systemPrompt,
      tools: {
        registry,
        context: {
          workspacePath: input.workspacePath,
          mode: permission.mode,
          trustedWorkspace: permission.trustedWorkspace,
          onCommandOutput: ({ callId, stream, text }) => {
            if (!text) return;
            appendRuntimeEvent({
              id: crypto.randomUUID(),
              seq: nextSeq(nextEvents),
              threadId: activeThreadId,
              turnId,
              createdAt: new Date().toISOString(),
              type: "command_output_delta",
              callId,
              stream,
              text
            });
          },
          onRuntimeEvent: (event) => {
            appendRuntimeEvent({
              id: crypto.randomUUID(),
              seq: nextSeq(nextEvents),
              threadId: activeThreadId,
              turnId,
              createdAt: new Date().toISOString(),
              ...event
            } as RuntimeEvent);
            void input.persistSession(activeThreadId, nextEvents, { silent: true });
          }
        },
        isToolCallAllowed: (call) => isDesktopToolAllowedForProfile(call.name, toolProfile),
        requestApproval: (call) => {
          const cachedDecision = cachedApprovalDecision(sessionApprovalCache.current, call);
          if (cachedDecision) {
            return Promise.resolve(cachedDecision);
          }
          const autoDecision = autoReviewDecisionForCall(input.permissionPreset, call);
          if (autoDecision) {
            return Promise.resolve(autoDecision);
          }

          return new Promise((resolve) => {
            approvalResolver.current = resolve;
            setPendingApproval(call);
          });
        },
        requestInteraction: (request) => {
          setPendingInteraction(request);
          return new Promise((resolve) => {
            interactionResolver.current = resolve;
          });
        }
      }
    });

    try {
      for await (const event of engine.startTurn({
        threadId: activeThreadId,
        turnId,
        text: userPrompt,
        modelText: llmPrompt,
        history: runtimeContext.messages,
        historyOmittedMessages: runtimeContext.omittedMessages,
        historyTruncated: runtimeContext.truncated,
        historyCompressed: runtimeContext.compressed,
        historySummaryChars: runtimeContext.summaryChars,
        historyReasoningReplayTokens: runtimeContext.reasoningReplayTokens,
        historyReasoningRetention: runtimeContext.reasoningRetention,
        historyCheckpoint: runtimeContext.checkpoint,
        seqStart: nextSeq(nextEvents),
        signal: runController.signal
      })) {
        if (event.type === "user_message") {
          syncEarlyUserMessageToLedger();
          continue;
        }
        appendRuntimeEvent(event);
      }
    } catch (error) {
      if (error instanceof ToolProfileEscalationError && input.provider === "deepseek" && toolProfile === "readonly") {
        escalateToPro = error;
        nextEvents = [...priorEvents, earlyUserMessageEvent];
        if (visibleThreadIdRef.current === activeThreadId) {
          input.setEvents(nextEvents);
        }
        restoreMapEntry(immutablePrefixSnapshots.current, activeThreadId, previousImmutablePrefix);
        restoreMapEntry(assembledRequestSnapshots.current, activeThreadId, previousAssembledRequest);
        setActiveSessionMessage(`Flash 请求了 ${error.call.name}，已升级到 Pro 继续执行。`);
      } else if (visibleThreadIdRef.current === activeThreadId) {
        input.setProviderError(messageFromUnknown(error));
      }
    } finally {
      let snapshotId: string | undefined;
      let sidePostSnapshotId: string | undefined;
      let sidePostGitCommit: string | undefined;

      if (!escalateToPro && toolProfile !== "readonly") {
        try {
          const sidePostSnapshot = await input.snapshotStore.saveSideSnapshot({
            label: "post-turn",
            snapshotId: createSideSnapshotId(turnId, "post"),
            threadId: activeThreadId,
            turnId,
            workspacePath: input.workspacePath
          });
          sidePostSnapshotId = sidePostSnapshot?.id;
          sidePostGitCommit = sidePostSnapshot?.sideGitCommit;
          sideGitBranch = sideGitBranch ?? sidePostSnapshot?.sideGitBranch;
        } catch (error) {
          input.setChangesMessage(`保存 post side snapshot 失败：${messageFromUnknown(error)}`);
        }
      }

      if (!escalateToPro && (input.taskFileChangesRef.current.length > 0 || sideSnapshotId)) {
        const snapshot = snapshotFromTrackedChanges({
          changes: input.taskFileChangesRef.current,
          threadId: activeThreadId,
          turnId,
          workspacePath: input.workspacePath,
          sideSnapshotId,
          sidePostSnapshotId,
          sideGitCommit,
          sidePostGitCommit,
          sideGitBranch
        });
        try {
          await input.snapshotStore.saveTurnSnapshot(snapshot);
          snapshotId = snapshot.id;
        } catch (error) {
          input.setChangesMessage(`保存本轮文件快照失败：${messageFromUnknown(error)}`);
        }
      }

      if (!escalateToPro) {
        const fileChangeEvents = trackedChangesToRuntimeEvents({
          changes: input.taskFileChangesRef.current,
          threadId: activeThreadId,
          turnId,
          snapshotId,
          seqStart: nextSeq(nextEvents)
        });
        for (const event of fileChangeEvents) {
          appendRuntimeEvent(event);
        }
        if (snapshotId) {
          appendRuntimeEvent({
            id: crypto.randomUUID(),
            seq: nextSeq(nextEvents),
            threadId: activeThreadId,
            turnId,
            createdAt: new Date().toISOString(),
            type: "turn_snapshot",
            snapshotId,
            sideSnapshotId,
            sidePostSnapshotId,
            sideGitCommit,
            sidePostGitCommit,
            sideGitBranch,
            fileCount: input.taskFileChangesRef.current.length
          } as RuntimeEvent);
        }
        const projectDelta = buildProjectDeltaEventBody(nextEvents, turnId);
        if (projectDelta) {
          appendRuntimeEvent({
            id: crypto.randomUUID(),
            seq: nextSeq(nextEvents),
            threadId: activeThreadId,
            turnId,
            createdAt: new Date().toISOString(),
            ...projectDelta
          } as RuntimeEvent);
        }
        if (nextEvents.length > 0) {
          await input.persistSession(activeThreadId, nextEvents);
        }
      }
      if (runAbortController.current === runController) {
        runAbortController.current = null;
        setIsRunning(false);
      }
      if (pendingInteractionEvent && visibleThreadIdRef.current === activeThreadId) {
        setPendingInteraction(pendingInteractionEvent);
      }
    }

    if (escalateToPro && visibleThreadIdRef.current === activeThreadId) {
      input.taskFileChangesRef.current = [];
      input.setTaskFileChanges([]);
      await runAgentTurn(userPrompt, {
        forceDeepSeekModelMode: "pro",
        priorEvents,
        skipLocalRouting: true,
        visibleUserEvent: earlyUserMessageEvent
      });
    }
    } catch (error) {
      if (!runController.signal.aborted && visibleThreadIdRef.current === activeThreadId) {
        input.setProviderError(messageFromUnknown(error));
      }
    } finally {
      if (runAbortController.current === runController) {
        runAbortController.current = null;
        setIsRunning(false);
        setActiveSessionMessage(null);
      }
    }
  }

  function stopAgentTurn() {
    runAbortController.current?.abort();
    if (pendingApproval) {
      approvalResolver.current?.({ callId: pendingApproval.id, decision: "denied" });
      approvalResolver.current = null;
      setPendingApproval(null);
    }
    if (pendingInteraction) {
      interactionResolver.current?.(undefined);
      interactionResolver.current = null;
      setPendingInteraction(null);
    }
    input.setSessionMessage("正在停止当前任务。");
  }

  function decideApproval(decision: ApprovalDecision["decision"], editedInput?: unknown, rememberForSession = false) {
    if (!pendingApproval) {
      return;
    }

    const resolvedDecision: ApprovalDecision = {
      callId: pendingApproval.id,
      decision: rememberForSession && decision === "approved-once" ? "approved-always" : decision,
      ...(decision === "edited" ? { editedInput } : {})
    };
    if (resolvedDecision.decision === "approved-always" && isCacheableApproval(pendingApproval)) {
      sessionApprovalCache.current.set(approvalCacheKey(pendingApproval), resolvedDecision);
      setSessionApprovalCacheCount(sessionApprovalCache.current.size);
    }
    approvalResolver.current?.(resolvedDecision);
    approvalResolver.current = null;
    setPendingApproval(null);
  }

  async function decideInteraction(decision: InteractionDecision) {
    if (!pendingInteraction) {
      return;
    }

    const decisionEvent: RuntimeEvent = {
      id: crypto.randomUUID(),
      seq: nextSeq(input.events),
      threadId: pendingInteraction.threadId,
      turnId: pendingInteraction.turnId,
      createdAt: new Date().toISOString(),
      type: "interaction_decided",
      requestId: pendingInteraction.requestId,
      decision
    };
    if (interactionResolver.current) {
      interactionResolver.current(decision);
      interactionResolver.current = null;
      setPendingInteraction(null);
      return;
    }

    const nextEvents = [...input.events, decisionEvent];
    input.setEvents(nextEvents);
    setPendingInteraction(null);
    await input.persistSession(input.threadId, nextEvents, { silent: true });
    void runAgentTurn(INTERACTION_CONTINUE_PROMPT, { priorEvents: nextEvents });
  }

  function clearSessionApprovalCache() {
    sessionApprovalCache.current.clear();
    setSessionApprovalCacheCount(0);
  }

  return {
    clearSessionApprovalCache,
    decideInteraction,
    decideApproval,
    isRunning,
    pendingApproval,
    sessionApprovalCacheCount,
    pendingInteraction,
    pendingApprovalRisk,
    runAgentTurn,
    setPendingApproval,
    stopAgentTurn
  };
}

function composePromptWithComposerContext(
  prompt: string,
  input: {
    attachments: ComposerAttachment[];
    codebaseContext?: string;
    includeIdeContext: boolean;
    workspacePath: string;
  }
) {
  const contextLines: string[] = [];

  if (input.includeIdeContext) {
    contextLines.push(`IDE 背景信息：当前 workspace 为 ${input.workspacePath}`);
  }

  if (input.attachments.length > 0) {
    contextLines.push(
      "用户添加的上下文附件：",
      ...input.attachments.map((attachment) => `- ${attachment.name}: ${attachment.path}`)
    );
  }

  if (input.codebaseContext?.trim()) {
    contextLines.push(input.codebaseContext.trim());
  }

  if (contextLines.length === 0) {
    return prompt;
  }

  return `<context>\n${contextLines.join("\n")}\n</context>\n\n${prompt}`;
}

function appendProOrchestrationContext(prompt: string, contextBlock: string) {
  return `${prompt}\n\n${contextBlock}`;
}

async function appendLocalAssistantTurn(input: {
  events: RuntimeEvent[];
  persistSession: UseAgentRunnerInput["persistSession"];
  response: string;
  setAttachments: UseAgentRunnerInput["setAttachments"];
  setEvents: UseAgentRunnerInput["setEvents"];
  setPromptText: UseAgentRunnerInput["setPromptText"];
  setProviderError: UseAgentRunnerInput["setProviderError"];
  setSessionMessage: UseAgentRunnerInput["setSessionMessage"];
  threadId: string;
  userPrompt: string;
}) {
  const turnId = crypto.randomUUID();
  const appendEvent = (
    events: RuntimeEvent[],
    body: Omit<Extract<RuntimeEvent, { type: "user_message" | "assistant_message" }>, "createdAt" | "id" | "seq" | "threadId" | "turnId">
  ) => [
    ...events,
    {
      id: crypto.randomUUID(),
      seq: nextSeq(events),
      threadId: input.threadId,
      turnId,
      createdAt: new Date().toISOString(),
      ...body
    } as RuntimeEvent
  ];

  let nextEvents = appendEvent(input.events, { type: "user_message", text: input.userPrompt });
  nextEvents = appendEvent(nextEvents, { type: "assistant_message", text: input.response });
  input.setProviderError(null);
  input.setSessionMessage(null);
  input.setPromptText("");
  input.setAttachments([]);
  input.setEvents(nextEvents);
  await input.persistSession(input.threadId, nextEvents);
}

async function safeBuildProjectIndexContext(input: {
  fileHost: ReturnType<typeof createRuntimeFileHost>;
  priorEvents: RuntimeEvent[];
  prompt: string;
  trackedChanges: TrackedFileChange[];
  workspacePath: string;
}) {
  try {
    return await buildProjectIndexContext(input);
  } catch {
    return {
      block: "",
      graph: null,
      queryTerms: [],
      recentPaths: [],
      semanticIndex: null,
      relevantFiles: []
    };
  }
}

function buildCodebaseContextEvent(
  projectIndex: ProjectIndexContext
): Omit<Extract<RuntimeEvent, { type: "codebase_context" }>, "createdAt" | "id" | "seq" | "threadId" | "turnId"> {
  const paths = projectIndex.relevantFiles.map((file) => file.path);
  if (paths.length > 0) {
    return {
      type: "codebase_context",
      status: "hit",
      fileCount: paths.length,
      paths,
      semanticIndexSource: projectIndex.semanticIndex?.source ?? "none",
      semanticIndexDocumentCount: projectIndex.semanticIndex?.documentCount,
      message: `已参考 ${paths.length} 个相关文件。`
    };
  }

  if (projectIndex.semanticIndex) {
    return {
      type: "codebase_context",
      status: "miss",
      fileCount: 0,
      paths: [],
      semanticIndexSource: projectIndex.semanticIndex.source,
      semanticIndexDocumentCount: projectIndex.semanticIndex.documentCount,
      message: "项目索引未命中相关文件。"
    };
  }

  return {
    type: "codebase_context",
    status: "skipped",
    fileCount: 0,
    paths: [],
    semanticIndexSource: "none",
    message: "本轮未注入代码库上下文。"
  };
}

export function resolveActiveModel(input: {
  classifier?: DeepSeekTurnClassifierResult | null;
  provider: Provider;
  effectiveProviderConfig: ProviderConfig | null;
  deepSeekModel: string;
  deepSeekBaseUrl: string;
  deepSeekModelMode: DeepSeekModelMode;
  prompt: string;
  priorEvents?: RuntimeEvent[];
  contextTextChars?: number;
  hasAttachments?: boolean;
}): {
  mode: string;
  route?: ResolvedDeepSeekTurnModel["route"];
  resolvedModel?: string;
  reason: string;
  localResponse?: string;
  deepSeek?: ResolvedDeepSeekTurnModel;
} {
  if (input.provider === "mock") {
    return { mode: "mock", route: "pro_agent", resolvedModel: "mock", reason: "mock_provider" };
  }

  const providerConfig = input.effectiveProviderConfig ?? fallbackDeepSeekProvider(input.deepSeekModel, input.deepSeekBaseUrl);
  if (input.provider === "deepseek") {
    const deepSeek = resolveDeepSeekTurnModel({
      classifier: input.classifier,
      modelMode: input.deepSeekModelMode,
      prompt: input.prompt,
      recentEvents: input.priorEvents,
      contextTextChars: input.contextTextChars,
      hasAttachments: input.hasAttachments
    });
    return {
      mode: deepSeek.mode,
      route: deepSeek.route,
      resolvedModel: deepSeek.resolvedModel,
      reason: deepSeek.reason,
      localResponse: deepSeek.localResponse,
      deepSeek
    };
  }

  return { mode: "provider", route: "pro_agent", resolvedModel: providerConfig.model, reason: "configured_provider" };
}

function shouldRunDeepSeekFlashClassifier(resolution: ReturnType<typeof resolveActiveModel>) {
  return resolution.deepSeek?.requiresClassifier === true;
}

function shouldRunDeepSeekProOrchestration(input: {
  contextTextChars?: number;
  modelResolution: ReturnType<typeof resolveActiveModel>;
  priorEvents?: RuntimeEvent[];
  provider: Provider;
  relevantFileCount?: number;
  userPrompt: string;
}) {
  const deepSeek = input.modelResolution.deepSeek;
  return input.provider === "deepseek" &&
    deepSeek?.mode === "auto" &&
    deepSeek?.route === "pro_agent" &&
    deepSeek.toolProfile === "full" &&
    deepSeek.resolvedModel === DEEPSEEK_V4_PRO_MODEL &&
    shouldUseDeepSeekProOrchestration({
      contextTextChars: input.contextTextChars,
      prompt: input.userPrompt,
      recentEvents: input.priorEvents,
      relevantFileCount: input.relevantFileCount,
      routingReason: deepSeek.reason
    });
}

function resolveModelMessageLedger(
  ledgers: Map<string, ModelLedgerRecord>,
  threadId: string,
  events: RuntimeEvent[]
): ModelLedgerRecord {
  const lastSeq = events.reduce((max, event) => Math.max(max, event.seq), -1);
  const eventHash = modelLedgerEventHash(events);
  const current = ledgers.get(threadId);
  if (current && current.eventCount === events.length && current.lastSeq === lastSeq && current.eventHash === eventHash) {
    return current;
  }

  const record = {
    ledger: ModelMessageLedger.fromEvents(events),
    eventCount: events.length,
    lastSeq,
    eventHash
  };
  ledgers.set(threadId, record);
  return record;
}

function syncModelMessageLedgerRecord(record: ModelLedgerRecord, event: RuntimeEvent, eventCount: number) {
  record.ledger.append(event);
  record.eventCount = eventCount;
  record.lastSeq = Math.max(record.lastSeq, event.seq);
  record.eventHash = appendModelLedgerEventHash(record.eventHash, event);
}

function modelLedgerEventHash(events: RuntimeEvent[]) {
  return events.reduce((hash, event) => appendModelLedgerEventHash(hash, event), "");
}

function appendModelLedgerEventHash(previousHash: string, event: RuntimeEvent) {
  return hashString(`${previousHash}|${event.seq}:${event.id}:${event.type}:${JSON.stringify(event)}`);
}

function hashString(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function resolveSkillPromptFromSlashInput(
  input: string,
  commands: SlashCommand[]
): { lazyContext?: NonNullable<SlashCommand["lazyContext"]>; prompt: string; skill: { id: string; name: string } } | null {
  const parsed = parseSlashCommand(input);
  if (!parsed) {
    return null;
  }

  const command = commands.find((item) => item.name === parsed.name && item.skillPrompt);
  const prompt = command ? renderSkillPromptFromCommand(command, parsed.args) : null;
  if (!command?.skillId || !prompt) {
    return null;
  }

  return {
    lazyContext: command.lazyContext,
    prompt,
    skill: {
      id: command.skillId,
      name: command.description.replace(/^使用技能：/, "") || command.skillId
    }
  };
}

function trackedChangesToRuntimeEvents(input: {
  changes: TrackedFileChange[];
  threadId: string;
  turnId: string;
  snapshotId?: string;
  seqStart: number;
}): RuntimeEvent[] {
  return input.changes.map((change, index) => ({
    id: crypto.randomUUID(),
    seq: input.seqStart + index,
    threadId: input.threadId,
    turnId: input.turnId,
    createdAt: new Date().toISOString(),
    type: "file_changed",
    path: change.path,
    changeKind: change.changeKind,
    snapshotId: input.snapshotId,
    existedBefore: change.existedBefore,
    additions: change.additions,
    deletions: change.deletions,
    diff: change.diff,
    undoable: change.undoable
  }));
}

function createSideSnapshotId(turnId: string, label: "pre" | "post") {
  return `side-snapshot-${turnId}-${label}`.replace(/[^A-Za-z0-9_-]/g, "-");
}

function nextSeq(events: RuntimeEvent[]) {
  return events.reduce((max, event) => Math.max(max, event.seq), -1) + 1;
}

function restoreMapEntry<K, V>(map: Map<K, V>, key: K, value: V | undefined) {
  if (value === undefined) {
    map.delete(key);
  } else {
    map.set(key, value);
  }
}

function getShellApprovalRisk(call: ToolCall | null): CommandRiskAssessment | null {
  if (!call || (call.name !== "exec_shell" && call.name !== "run_tests")) {
    return null;
  }

  const input = call.input && typeof call.input === "object" ? call.input as { command?: unknown } : null;
  const command = call.name === "run_tests"
    ? resolveRunTestsCommand(call.input).command
    : typeof input?.command === "string" ? input.command : "";
  return assessCommandRisk(command);
}

function cachedApprovalDecision(cache: Map<string, ApprovalDecision>, call: ToolCall): ApprovalDecision | undefined {
  const decision = cache.get(approvalCacheKey(call));
  return decision ? { ...decision, callId: call.id } : undefined;
}

function isCacheableApproval(call: ToolCall): boolean {
  if ((call.capability as string | undefined) === "high-risk") {
    return false;
  }
  if (call.name === "exec_shell" || call.name === "run_tests") {
    const input = call.input && typeof call.input === "object" ? call.input as { command?: unknown } : null;
    const command = call.name === "run_tests"
      ? resolveRunTestsCommand(call.input).command
      : typeof input?.command === "string" ? input.command : "";
    const risk = assessCommandRisk(command);
    return risk.level !== "dangerous";
  }
  return (call.capability as string | undefined) !== "high-risk";
}

function approvalCacheKey(call: ToolCall) {
  return `${call.name}:${stableJson(call.input)}`;
}

function prefixInvalidationMessage(reason: PrefixInvalidationReason) {
  switch (reason) {
    case "new_session":
      return "已为当前会话创建新的 prefix 快照。";
    case "workspace_changed":
      return "工作区变化，已重建 prefix 快照。";
    case "provider_changed":
      return "Provider 变化，已重建 prefix 快照。";
    case "model_changed":
      return "模型变化，已重建 prefix 快照。";
    case "mode_changed":
      return "运行模式变化，已重建 prefix 快照。";
    case "system_prompt_changed":
      return "Core Prefix 变化，已重建 prefix 快照。";
    case "project_snapshot_changed":
      return "Project Snapshot 变化，已重建 prefix 快照。";
    case "unknown":
    default:
      return "Prefix 快照变化，已重建。";
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
