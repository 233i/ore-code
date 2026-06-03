import {
  useEffect,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type SetStateAction
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { ConfigProvider, Dialog } from "tdesign-react";
import tdesignEnUS from "tdesign-react/es/locale/en_US";
import tdesignZhCN from "tdesign-react/es/locale/zh_CN";
import type { NoteRecord, ResolvedDeepSeekTurnModel } from "@ore-code/agent-core";
import type { ArtifactMetadata, ArtifactRecord } from "@ore-code/protocol";
import type { RuntimeEvent, ToolCall } from "@ore-code/protocol";
import { AppSettingsOverlay } from "./app/AppSettingsOverlay";
import { AppSidebar } from "./app/AppSidebar";
import { AppTopbar } from "./app/AppTopbar";
import {
  createThreadId,
  firstUserPrompt,
  normalizeSettingsSection,
  riskLevelText,
  riskTagTheme
} from "./app/appShellUtils";
import type { Panel } from "./app/appTypes";
import { useAppSettingsController } from "./app/useAppSettingsController";
import { useProjectIndexController } from "./app/useProjectIndexController";
import { useSettingsOverlayProps } from "./app/useSettingsOverlayProps";
import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useResizablePanels
} from "./app/useResizablePanels";
import { useSessionActions } from "./app/useSessionActions";
import { useSkillController } from "./app/useSkillController";
import { useWorkspaceController } from "./app/useWorkspaceController";
import { sumChangeStat } from "./features/changes/changeSummary";
import { deriveShellJobs } from "./features/jobs/shellJobs";
import {
  derivePersistedTranscriptItems,
  transcriptItemsFromRecentEvents,
  transcriptItemsFromTail,
  type TranscriptHistoryGapItem
} from "./features/transcript/transcriptChunks";
import { createRuntimeArtifactStore } from "./services/artifactStore";
import {
  buildEnvironmentInstallPlan,
  detectEnvironmentInstallPlatform,
  runEnvironmentInstallPlan,
  type EnvironmentInstallPlan,
  type EnvironmentInstallStepResult
} from "./services/environmentInstallPlan";
import { createRuntimeFileHost, isTauriRuntime } from "./services/fileHost";
import { createRuntimeNoteStore } from "./services/noteStore";
import { createRuntimeProcessHost } from "./services/processHost";
import { createRuntimeShellHost } from "./services/shellHost";
import { loadSessionTranscriptChunk, type SessionSummary } from "./services/sessionStore";
import {
  renderSkillIndex,
  skillSlashCommands,
  suggestSkillsForPrompt
} from "./services/skillRegistry";
import {
  createTurnSnapshotStore
} from "./services/turnSnapshotStore";
import { deriveUsageSummary } from "./services/usageSummary";
import {
  detectWorkspaceSignals,
  runEnvironmentDoctor,
  summarizeDoctor,
  type DoctorCheck,
  type EnvironmentPaths,
  type WorkspaceSignals
} from "./services/workspaceDoctor";
import { AutomationWorkspace } from "./ui/AutomationWorkspace";
import { ChangeSummaryCard } from "./ui/ChangeSummaryCard";
import { ComposerBar } from "./ui/ComposerBar";
import { ApprovalDialog, InteractionDialog, NewSessionDialog, SearchDialog } from "./ui/DialogPanels";
import { MarkdownView } from "./ui/MarkdownView";
import { SkillsWorkspace } from "./ui/SkillsWorkspace";
import { InspectorPanel } from "./ui/InspectorPanel";
import { Transcript, type TranscriptItem } from "./ui/Transcript";
import { formatToolPayload } from "./ui/ToolCard";
import { useMcpManager } from "./hooks/useMcpManager";
import { useAgentRunner } from "./hooks/useAgentRunner";
import { useAutomationActions } from "./hooks/useAutomationActions";
import { useDurableRuntime } from "./hooks/useDurableRuntime";
import { useFilePanel } from "./hooks/useFilePanel";
import { useSessions } from "./hooks/useSessions";
import { useShellJobsPanel } from "./hooks/useShellJobsPanel";
import { useTurnRestore } from "./hooks/useTurnRestore";
import {
  sameWorkspacePath,
  useWorkspaceProjects
} from "./hooks/useWorkspaceProjects";
import {
  providerLabel,
  useProviderConfig,
  type Provider
} from "./hooks/useProviderConfig";
import { parseSlashCommand, slashCommands as builtinSlashCommands } from "./ui/slashCommands";
import type { SettingsSection } from "./ui/settingsConfig";
import { useChangeReview } from "./hooks/useChangeReview";
import { createTranslator, I18nProvider } from "./i18n/I18nProvider";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/sidebar.css";
import "./styles/chat.css";
import "./styles/composer.css";
import "./styles/inspector.css";
import "./styles/settings.css";
import "./styles/skills.css";
import "./styles/dialogs.css";
import "./styles/automation.css";

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showAutomation, setShowAutomation] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>("general");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [threadId, setThreadId] = useState(() => createThreadId());
  const [activePanel, setActivePanel] = useState<Panel>("Changes");
  const [showInspector, setShowInspector] = useState(false);
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [transcriptItems, setTranscriptItems] = useState<TranscriptItem[]>([]);
  const [loadingEarlierTranscript, setLoadingEarlierTranscript] = useState(false);
  const [activeTurnSkill, setActiveTurnSkill] = useState<{ id: string; name: string } | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactMetadata[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactRecord | null>(null);
  const [artifactMessage, setArtifactMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [noteMessage, setNoteMessage] = useState<string | null>(null);
  const setSessionMessageRef = useRef<((value: string | null) => void) | null>(null);
  const captureSidebarOrderRef = useRef<(() => void) | null>(null);
  const setFilePanelPathRef = useRef<((path: string) => void) | null>(null);
  const {
    provider,
    setProvider,
    deepSeekApiKey,
    setDeepSeekApiKey,
    deepSeekModel,
    setDeepSeekModel,
    deepSeekModelMode,
    setDeepSeekModelMode,
    effectiveDeepSeekModelMode,
    deepSeekBaseUrl,
    setDeepSeekBaseUrl,
    deepSeekThinkingLevel,
    setDeepSeekThinkingLevel,
    oreCodeConfig,
    configMessage,
    providerError,
    setProviderError,
    providerTestMessage,
    secretStatus,
    secretMessage,
    providerOptions,
    effectiveProviderConfig,
    modelLabel,
    refreshOreCodeConfig,
    createLlmClient,
    createConfiguredProviderClient,
    resolveProviderApiKey,
    testProviderConnection,
    refreshProviderSecretStatus,
    saveDeepSeekApiKey,
    loadDeepSeekApiKey,
    removeDeepSeekApiKey
  } = useProviderConfig();
  const [lastResolvedDeepSeekModel, setLastResolvedDeepSeekModel] = useState<ResolvedDeepSeekTurnModel | null>(null);
  const {
    addComposerAttachment,
    applySkillSuggestion,
    composerAttachments,
    copyMessageText,
    expandedMessage,
    messageFeedback,
    promptText,
    removeComposerAttachment,
    selectSlashCommand,
    setComposerAttachments,
    setExpandedMessage,
    setMessageFeedback,
    setPromptText,
    toggleMessageFeedback
  } = useSessionActions({
    setSessionMessage: (message) => setSessionMessageRef.current?.(message)
  });
  const {
    applyWorkspacePath,
    chooseWorkspace,
    currentWorkspaceDisplay,
    currentWorkspaceLabel,
    loadWorkspaceSettings,
    loadWorkspaceStatus,
    recentWorkspacePaths,
    setWorkspaceInput,
    workspaceInput,
    workspacePath
  } = useWorkspaceController({
    onBeforeApplyWorkspacePath: () => captureSidebarOrderRef.current?.(),
    onWorkspacePathReady: () => setFilePanelPathRef.current?.(".")
  });
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>([]);
  const [doctorMessage, setDoctorMessage] = useState<string | null>(null);
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [environmentInstallDialogOpen, setEnvironmentInstallDialogOpen] = useState(false);
  const [environmentInstallPlanState, setEnvironmentInstallPlanState] = useState<EnvironmentInstallPlan | null>(null);
  const [environmentInstallResults, setEnvironmentInstallResults] = useState<EnvironmentInstallStepResult[]>([]);
  const [environmentInstallRunning, setEnvironmentInstallRunning] = useState(false);
  const { inspectorWidth, sidebarWidth, startPanelResize, workbenchStyle } = useResizablePanels({ showInspector });
  const {
    fileEntries,
    filePanelMessage,
    filePanelPath,
    goUpDirectory,
    openFileEntry,
    refreshFiles,
    setFilePanelPath
  } = useFilePanel({ setPromptText, workspacePath });
  setFilePanelPathRef.current = setFilePanelPath;
  const [sidebarQuery, setSidebarQuery] = useState("");
  const {
    createUserSkill,
    disabledSkillIds,
    enabledSkillCount,
    openUserSkillFolder,
    openUserSkillRoot,
    refreshSkills,
    renameUserSkill,
    setDisabledSkillIds,
    skillErrors,
    skillMessage,
    skillRootLabel,
    skills,
    toggleSkill,
    trashUserSkill,
    updateUserSkill,
    useSkill
  } = useSkillController({
    onSelectSkill: () => setShowSkills(false),
    setPromptText,
    setSessionMessage: (message) => setSessionMessageRef.current?.(message),
    workspacePath
  });
  const {
    enableCacheWarmup,
    includeIdeContext,
    loadSavedSettings,
    localePreference,
    mode,
    permissionPreset,
    persistAppSettings,
    resolvedLocale,
    resolvedTheme,
    setEnableCacheWarmup,
    setIncludeIdeContext,
    setLocalePreference,
    setMode,
    setPermissionPreset,
    setThemePreference,
    settingsLoaded,
    settingsMessage,
    themePreference,
    togglePlanMode
  } = useAppSettingsController({
    deepSeekBaseUrl,
    deepSeekModel,
    deepSeekModelMode,
    deepSeekThinkingLevel,
    disabledSkillIds,
    onDisabledSkillIdsLoaded: setDisabledSkillIds,
    onWorkspaceSettingsLoaded: loadWorkspaceSettings,
    provider,
    recentWorkspacePaths,
    refreshOreCodeConfig,
    setDeepSeekBaseUrl,
    setDeepSeekModel,
    setDeepSeekModelMode,
    setDeepSeekThinkingLevel,
    setProvider,
    workspacePath
  });
  const t = useMemo(() => createTranslator(resolvedLocale), [resolvedLocale]);
  const tdesignGlobalConfig = useMemo(() => ({
    ...(resolvedLocale === "en-US" ? tdesignEnUS : tdesignZhCN),
    classPrefix: "t"
  }), [resolvedLocale]);
  const { projectIndexStatus } = useProjectIndexController({
    events,
    settingsLoaded,
    workspacePath
  });
  const {
    mcpSnapshot,
    mcpMessage,
    mcpBusyLabel,
    setMcpSnapshot,
    setMcpMessage,
    refreshMcpTools,
    initMcpConfig,
    addMcpServer,
    updateMcpServer,
    toggleMcpServer,
    removeMcpServer,
    stopAllMcpServers,
    validateMcpConfig,
    readMcpResource,
    callMcpTool,
    useMcpPrompt
  } = useMcpManager({ setPromptText });
  const artifactStore = useRef(createRuntimeArtifactStore());
  const {
    durableTaskManager,
    automationManager,
    runDurableTaskExecutorTick
  } = useDurableRuntime({
    artifactStore,
    createConfiguredProviderClient,
    deepSeekBaseUrl,
    deepSeekModel,
    effectiveProviderConfig,
    provider,
    resolveProviderApiKey,
    workspacePath
  });
  const {
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
  } = useAutomationActions({
    automationManager,
    durableTaskManager,
    runDurableTaskExecutorTick,
    workspacePath
  });
  const {
    cancelBackgroundShellJob,
    jobMessage,
    refreshRuntimeShellJobs,
    runtimeShellJobs,
    startBackgroundShellJob
  } = useShellJobsPanel({
    activePanel,
    onOpenJobsPanel: () => switchResourcePanel("Jobs"),
    promptText,
    workspacePath
  });
  const pendingApprovalSetterRef = useRef<((value: SetStateAction<ToolCall | null>) => void) | null>(null);
  const setPendingApprovalProxy = (value: SetStateAction<ToolCall | null>) => {
    pendingApprovalSetterRef.current?.(value);
  };
  const appendSnapshotRestoredEventRef = useRef<((event: {
    failures: string[];
    ok: boolean;
    paths: string[];
    scope: "file" | "turn";
    snapshotId: string;
    turnId: string;
  }) => void) | null>(null);
  const {
    changeDiffPreview,
    changeReviewFileCount,
    changeReviewFiles,
    changeReviewGroups,
    changesMessage,
    copyChangeDiff,
    expandedChangeGroups,
    generateLightweightCommitMessageForChanges,
    refreshChanges,
    requestUndoChanges,
    reviewChanges,
    selectedChangeFile,
    selectedChangeGroup,
    selectedChangePath,
    lightweightCommitMessage,
    lightweightCommitMessageRunning,
    selectChangeFile,
    setChangeDiffPreview,
    setChangesMessage,
    setClearedChangeTurnId,
    setExpandedChangeGroups,
    setSelectedChangeGroup,
    setSelectedChangePath,
    setTaskFileChanges,
    taskFileChangesRef,
    totalReviewAdditions,
    totalReviewDeletions,
    undoChangeFile,
    useChangeInPrompt,
    visibleTaskChangeFileStats,
    canUndoChangeFile
  } = useChangeReview({
    appendSnapshotRestoredEventRef,
    createConfiguredProviderClient,
    events,
    onOpenPanel: (panel) => {
      setShowSkills(false);
      setShowAutomation(false);
      setShowSettings(false);
      setShowSearch(false);
      setShowNewSession(false);
      setShowInspector(true);
      setActivePanel(panel);
    },
    setPromptText,
    setSessionMessageRef,
    workspacePath
  });
  const {
    sessions,
    sessionMessage,
    setSessionMessage,
    renamingThreadId,
    setRenamingThreadId,
    renameDraft,
    setRenameDraft,
    sessionContextMenu,
    setSessionContextMenu,
    startNewSession,
    persistSession,
    refreshSessions,
    loadSession,
    beginRenameSession,
    commitRenameSession,
    openSessionContextMenu,
    copySessionTitle,
    removeSession,
    renameCurrentSessionFromCommand
  } = useSessions({
    events,
    setActiveTurnSkill,
    setChangeDiffPreview,
    setChangesMessage,
    setClearedChangeTurnId,
    setComposerAttachments,
    setEvents,
    setExpandedMessage,
    setMessageFeedback,
    setTranscriptItems,
    setPendingApproval: setPendingApprovalProxy,
    setPromptText,
    setSelectedChangeGroup,
    setSelectedChangePath,
    setShowInspector,
    setShowNewSession,
    setShowSearch,
    setShowSettings,
    setShowSkills,
    setTaskFileChanges,
    setThreadId,
    taskFileChangesRef,
    threadId,
    workspacePath
  });
  setSessionMessageRef.current = setSessionMessage;
  const {
    appendSnapshotRestoredEvent,
    restoreTurnFromCommand
  } = useTurnRestore({
    events,
    mode,
    permissionPreset,
    persistSession,
    refreshChanges,
    setChangeDiffPreview,
    setChangesMessage,
    setClearedChangeTurnId,
    setEvents,
    setSelectedChangeGroup,
    setSelectedChangePath,
    setSessionMessage,
    setTaskFileChanges,
    taskFileChangesRef,
    threadId,
    workspacePath
  });
  appendSnapshotRestoredEventRef.current = appendSnapshotRestoredEvent;
  const availableSlashCommands = useMemo(
    () => [
      ...builtinSlashCommands,
      ...skillSlashCommands(skills).filter(
        (command) => !builtinSlashCommands.some((builtin) => builtin.name === command.name)
      )
    ],
    [skills]
  );
  const lazyContextIndex = useMemo(() => renderSkillIndex(skills), [skills]);
  const snapshotStore = useRef(createTurnSnapshotStore());
  const {
    clearSessionApprovalCache,
    decideInteraction,
    decideApproval,
    isRunning,
    pendingApproval,
    pendingApprovalRisk,
    pendingInteraction,
    sessionApprovalCacheCount,
    runAgentTurn,
    setPendingApproval,
    stopAgentTurn
  } = useAgentRunner({
    artifactStore,
    attachments: composerAttachments,
    automationManager,
    availableSlashCommands,
    createConfiguredProviderClient,
    createLlmClient,
    deepSeekBaseUrl,
    deepSeekModel,
    deepSeekModelMode: effectiveDeepSeekModelMode,
    durableTaskManager,
    effectiveProviderConfig,
    events,
    executeLocalSlashCommand,
    enableCacheWarmup: enableCacheWarmup || Boolean(oreCodeConfig?.context.enableCacheWarmup),
    includeIdeContext,
    lazyContextIndex,
    mode,
    onDeepSeekModelResolved: setLastResolvedDeepSeekModel,
    permissionPreset,
    persistSession,
    provider,
    resolveProviderApiKey,
    setActiveTurnSkill,
    setAttachments: setComposerAttachments,
    setChangeDiffPreview,
    setChangesMessage,
    setClearedChangeTurnId,
    setEvents,
    setMcpMessage,
    setMcpSnapshot,
    setPromptText,
    setProviderError,
    setSelectedChangeGroup,
    setSelectedChangePath,
    setSessionMessage,
    setTaskFileChanges,
    snapshotStore: snapshotStore.current,
    taskFileChangesRef,
    threadId,
    workspacePath
  });
  pendingApprovalSetterRef.current = setPendingApproval;

  const deferredEvents = useDeferredValue(events);
  const shellJobs = useMemo(() => deriveShellJobs(deferredEvents), [deferredEvents]);
  const usageSummary = useMemo(() => deriveUsageSummary(deferredEvents), [deferredEvents]);
  const latestSubagentEvent = useMemo(
    () => [...deferredEvents].reverse().find((event): event is Extract<RuntimeEvent, { type: "subagent_completed" }> => event.type === "subagent_completed") ?? null,
    [deferredEvents]
  );
  const currentRuntimeThreadId = events[events.length - 1]?.threadId;
  const currentRuntimeEvents = currentRuntimeThreadId === threadId ? events : [];
  const conversationTitle = useMemo(
    () => sessions.find((summary) => summary.threadId === threadId)?.title ?? firstUserPrompt(currentRuntimeEvents) ?? "新对话",
    [currentRuntimeEvents, sessions, threadId]
  );
  const currentSessionFirstEventCreatedAt = currentRuntimeThreadId === threadId ? events[0]?.createdAt : undefined;
  const currentSessionSummary = useMemo<SessionSummary | null>(
    () => currentSessionFirstEventCreatedAt
      ? { threadId, title: conversationTitle, eventCount: 0, updatedAt: currentSessionFirstEventCreatedAt, workspacePath }
      : null,
    [conversationTitle, currentSessionFirstEventCreatedAt, threadId, workspacePath]
  );
  const {
    captureSidebarOrder,
    captureSidebarScrollForThread,
    expandedProjectPaths,
    filteredWorkspaceProjects,
    projectGroupsRef,
    searchableSessions,
    sidebarSessionCount,
    switchWorkspaceProject,
    toggleWorkspaceProject
  } = useWorkspaceProjects({
    currentSessionSummary,
    onApplyWorkspacePath: applyWorkspacePath,
    onStartNewSession: startNewSession,
    query: sidebarQuery,
    sessions,
    threadId,
    workspacePath
  });
  captureSidebarOrderRef.current = captureSidebarOrder;
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return query
      ? searchableSessions.filter((summary) => summary.title.toLowerCase().includes(query))
      : searchableSessions;
  }, [searchQuery, searchableSessions]);
  const skillSuggestions = useMemo(
    () => suggestSkillsForPrompt(promptText, skills),
    [promptText, skills]
  );

  useEffect(() => {
    if (events.length === 0) {
      setTranscriptItems([]);
      return;
    }

    const eventThreadId = events[events.length - 1]?.threadId;
    if (eventThreadId && eventThreadId !== threadId) {
      return;
    }

    setTranscriptItems(transcriptItemsFromRecentEvents(events));
  }, [events, threadId]);

  async function loadEarlierTranscript(gap: TranscriptHistoryGapItem) {
    if (loadingEarlierTranscript) {
      return;
    }

    setLoadingEarlierTranscript(true);
    try {
      if (typeof gap.previousChunkIndex === "number") {
        const earlier = await loadSessionTranscriptChunk(threadId, gap.previousChunkIndex);
        const earlierItems = transcriptItemsFromTail(earlier);
        if (earlierItems.length > 0) {
          setTranscriptItems((current) => [
            ...earlierItems,
            ...(current[0]?.type === "history_gap" ? current.slice(1) : current)
          ]);
          return;
        }
      }

      if (events.length > 0) {
        setTranscriptItems(derivePersistedTranscriptItems(events));
      }
    } catch (error) {
      setSessionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingEarlierTranscript(false);
    }
  }

  useEffect(() => {
    void refreshSessions();
    void loadSavedSettings();
    void refreshMcpTools();
  }, []);

  useEffect(() => {
    if (activePanel === "Files") {
      void refreshFiles();
    }

    if (activePanel === "Changes") {
      void refreshChanges();
    }

    if (activePanel === "Jobs") {
      void refreshRuntimeShellJobs();
    }

    if (activePanel === "Artifacts") {
      void refreshArtifacts();
    }

    if (activePanel === "Skills") {
      void refreshSkills();
    }
  }, [activePanel, workspacePath]);

  useEffect(() => {
    if (showSettings && activeSettingsSection === "data") {
      void refreshNotes();
    }
  }, [activeSettingsSection, showSettings, workspacePath]);

  useEffect(() => {
    if (!showInspector) {
      return;
    }

    void refreshChanges();
  }, [showInspector, workspacePath]);

  useEffect(() => {
    if (!showInspector || selectedChangePath || changeReviewFiles.length === 0) {
      return;
    }

    const [firstFile] = changeReviewFiles;
    void selectChangeFile(firstFile.path, firstFile.group);
  }, [changeReviewFiles, selectedChangePath, showInspector]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    const tick = async () => {
      try {
        await automationManager.current.reload();
        await durableTaskManager.current.reload();
        await runDurableTaskExecutorTick();
        if (showAutomation) {
          await refreshAutomationWorkspace();
        }
      } catch (error) {
        console.warn("Failed to run background durable tasks", error);
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [settingsLoaded, showAutomation, workspacePath]);

  useEffect(() => {
    if (!showInspector) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowInspector(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showInspector]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }

      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const isEditableTarget = Boolean(
        target?.closest("input, textarea, [contenteditable='true']")
      );

      if (key === "n" && !isEditableTarget) {
        event.preventDefault();
        openNewSessionDialog();
        return;
      }

      if (key === "k" && !showSearch && !showNewSession) {
        event.preventDefault();
        setPromptText((current) => current || "/");
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus();
        });
        return;
      }

      if (key === "f" && event.shiftKey && !isEditableTarget) {
        event.preventDefault();
        openSearchPanel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showNewSession, showSearch]);

  useEffect(() => {
    if (provider !== "deepseek") {
      void refreshProviderSecretStatus(provider);
    } else {
      void refreshProviderSecretStatus("deepseek");
    }
  }, [provider]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }
    void refreshOreCodeConfig(workspacePath);
  }, [settingsLoaded, workspacePath]);

  useEffect(() => {
    if (!settingsLoaded || !isTauriRuntime()) {
      return;
    }

    const storageKey = "ore-code.environmentDoctor.autoRun.v1";
    try {
      if (window.localStorage.getItem(storageKey)) {
        return;
      }
      window.localStorage.setItem(storageKey, "1");
    } catch {
      return;
    }

    void runDoctor();
  }, [settingsLoaded]);

  useEffect(() => {
    void refreshChanges();
  }, [workspacePath]);

  useEffect(() => {
    if (showSkills) {
      void refreshMcpTools();
    }
  }, [showSkills]);

  useEffect(() => {
    if (!showSettings) {
      return;
    }

    if (activeSettingsSection === "mcp") {
      void refreshMcpTools();
    }

    if (activeSettingsSection === "automation") {
      void refreshAutomationWorkspace();
    }
  }, [activeSettingsSection, showSettings]);

  async function executeLocalSlashCommand(input: string): Promise<boolean> {
    const parsed = parseSlashCommand(input);
    if (!parsed) {
      return false;
    }

    setPromptText("");

    switch (parsed.name) {
      case "/config":
        openSettingsSection(parsed.args);
        setSessionMessage("已打开设置。");
        return true;
      case "/diff":
        reviewChanges();
        setSessionMessage("已打开变更面板。");
        return true;
      case "/restore":
        await restoreTurnFromCommand(parsed.args);
        return true;
      case "/sessions":
        openSearchPanel(parsed.args);
        setSessionMessage("已打开对话搜索。");
        return true;
      case "/jobs":
        switchResourcePanel("Jobs");
        await refreshRuntimeShellJobs();
        setSessionMessage("已打开后台任务面板。");
        return true;
      case "/files":
        switchResourcePanel("Files");
        await refreshFiles();
        setSessionMessage("已打开文件面板。");
        return true;
      case "/skills":
        openSkillsPanel();
        setSessionMessage("已打开技能面板。");
        return true;
      case "/doctor":
        openSettingsPanel();
        setActiveSettingsSection("doctor");
        await runDoctor();
        return true;
      case "/rename":
        await renameCurrentSessionFromCommand(parsed.args);
        return true;
      case "/new":
        openNewSessionDialog();
        setSessionMessage("请选择新对话工作区。");
        return true;
      case "/clear":
        startNewSession();
        return true;
      case "/plan":
        setMode("plan");
        setSessionMessage("已切换到计划模式。");
        return true;
      case "/agent":
        setPermissionPreset("default");
        setMode("agent");
        setSessionMessage("已切换到默认审批模式。");
        return true;
      case "/yolo":
        setPermissionPreset("fullAccess");
        setMode("yolo");
        setSessionMessage("已切换到完全访问权限。");
        return true;
      default:
        setSessionMessage(`未知命令：${parsed.name}`);
        return true;
    }
  }

  function openSettingsSection(sectionName: string) {
    const section = normalizeSettingsSection(sectionName);
    openSettingsPanel();
    if (section) {
      setActiveSettingsSection(section);
    }
  }

  async function refreshArtifacts() {
    try {
      const nextArtifacts = await artifactStore.current.list();
      setArtifacts(nextArtifacts);
      setArtifactMessage(`${nextArtifacts.length} artifacts`);
      if (selectedArtifact && !nextArtifacts.some((artifact) => artifact.id === selectedArtifact.id)) {
        setSelectedArtifact(null);
      }
    } catch (error) {
      setArtifacts([]);
      setSelectedArtifact(null);
      setArtifactMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshNotes() {
    try {
      const store = createRuntimeNoteStore(workspacePath);
      const nextNotes = await store.listNotes();
      setNotes(nextNotes);
      setNoteMessage(`${nextNotes.length} 条记忆`);
    } catch (error) {
      setNotes([]);
      setNoteMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteNote(id: string) {
    try {
      const store = createRuntimeNoteStore(workspacePath);
      await store.deleteNote(id);
      await refreshNotes();
    } catch (error) {
      setNoteMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function openArtifact(id: string) {
    try {
      const artifact = await artifactStore.current.read(id);
      setSelectedArtifact(artifact);
      setArtifactMessage(artifact.summary);
    } catch (error) {
      setSelectedArtifact(null);
      setArtifactMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadSessionForWorkspace(summary: SessionSummary) {
    if (isRunning) {
      stopAgentTurn();
    }
    captureSidebarScrollForThread(summary.threadId);
    closeWorkspacePanels();
    if (summary.workspacePath && !sameWorkspacePath(summary.workspacePath, workspacePath)) {
      await applyWorkspacePath(summary.workspacePath);
    }
    await loadSession(summary);
  }

  async function collectDoctorContext(): Promise<{ environmentPaths?: EnvironmentPaths; workspaceSignals: WorkspaceSignals }> {
    const fileHost = createRuntimeFileHost();
    const [environmentPaths, workspaceSignals] = await Promise.all([
      loadEnvironmentPaths(),
      detectWorkspaceSignals(fileHost, workspacePath)
    ]);
    return { environmentPaths, workspaceSignals };
  }

  async function loadEnvironmentPaths(): Promise<EnvironmentPaths | undefined> {
    if (!isTauriRuntime()) {
      return undefined;
    }

    const [homeResult, statusResult] = await Promise.allSettled([
      invoke<string>("user_home_dir"),
      invoke<{ appDataDir: string }>("workspace_status")
    ]);

    const userHomePath = homeResult.status === "fulfilled" ? homeResult.value : undefined;
    const appDataPath = statusResult.status === "fulfilled" ? statusResult.value.appDataDir : undefined;
    return userHomePath || appDataPath ? { userHomePath, appDataPath } : undefined;
  }

  async function runDoctor(): Promise<{ checks: DoctorCheck[]; workspaceSignals: WorkspaceSignals | null }> {
    setDoctorRunning(true);
    setDoctorMessage("正在检查 Ore Code 运行环境、工具链和 provider...");

    try {
      const doctorContext = await collectDoctorContext();
      const checks = await runEnvironmentDoctor({
        workspacePath,
        provider,
        providerLabel: effectiveProviderConfig?.label ?? providerLabel(provider),
        secretStatus,
        processHost: createRuntimeProcessHost(),
        shellHost: createRuntimeShellHost(),
        fileHost: createRuntimeFileHost(),
        environmentPaths: doctorContext.environmentPaths,
        workspaceSignals: doctorContext.workspaceSignals,
        configSources: oreCodeConfig?.sources
      });
      setDoctorChecks(checks);
      setDoctorMessage(summarizeDoctor(checks));
      return { checks, workspaceSignals: doctorContext.workspaceSignals };
    } catch (error) {
      setDoctorMessage(error instanceof Error ? error.message : String(error));
      return { checks: [], workspaceSignals: null };
    } finally {
      setDoctorRunning(false);
    }
  }

  async function buildEnvironmentInstallPlanForSettings() {
    setEnvironmentInstallResults([]);
    const doctorResult = await runDoctor();
    const plan = buildEnvironmentInstallPlan(
      doctorResult.checks,
      detectEnvironmentInstallPlatform(),
      doctorResult.workspaceSignals,
      workspacePath
    );
    setEnvironmentInstallPlanState(plan);
    setEnvironmentInstallDialogOpen(true);
  }

  async function runEnvironmentInstallPlanFromSettings() {
    if (!environmentInstallPlanState || environmentInstallRunning) {
      return;
    }

    setEnvironmentInstallRunning(true);
    setEnvironmentInstallResults([]);
    setDoctorMessage("正在按确认的计划修复环境...");

    try {
      const result = await runEnvironmentInstallPlan(
        environmentInstallPlanState,
        createRuntimeProcessHost(),
        (stepResult) => {
          setEnvironmentInstallResults((current) => [...current, stepResult]);
        }
      );
      setDoctorMessage(result.ok ? "环境修复计划已执行完成。" : "环境修复计划执行完成，部分步骤失败或需要手动处理。");
      await runDoctor();
    } catch (error) {
      setDoctorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setEnvironmentInstallRunning(false);
    }
  }

  function closeWorkspacePanels() {
    setShowAutomation(false);
    setShowSkills(false);
    setShowSettings(false);
    setShowSearch(false);
    setShowNewSession(false);
    setShowInspector(false);
  }

  function openNewSessionDialog() {
    closeWorkspacePanels();
    setShowNewSession(true);
  }

  function openSkillsPanel() {
    closeWorkspacePanels();
    setShowSkills(true);
    void refreshSkills();
    void refreshMcpTools();
  }

  function openAutomationPanel() {
    closeWorkspacePanels();
    setShowAutomation(true);
    void refreshAutomationWorkspace();
  }

  function openSearchPanel(initialQuery = "") {
    setShowSkills(false);
    setShowAutomation(false);
    setShowSettings(false);
    setShowInspector(false);
    setShowNewSession(false);
    setShowSearch(true);
    setSearchQuery(initialQuery);
  }

  function openSettingsPanel() {
    setShowSkills(false);
    setShowAutomation(false);
    setShowInspector(false);
    setShowSearch(false);
    setShowNewSession(false);
    setShowSettings(true);
  }

  function switchResourcePanel(panel: Panel) {
    setShowSkills(false);
    setShowAutomation(false);
    setShowSettings(false);
    setShowSearch(false);
    setShowNewSession(false);
    setShowInspector(true);
    setActivePanel(panel);
    if (panel === "Changes") {
      void refreshChanges();
    }
  }

  const settingsOverlayProps = useSettingsOverlayProps({
    activeSettingsSection,
    applyWorkspacePath,
    artifactsCount: artifacts.length,
    automationBusy,
    automationCount: automations.length,
    automationMessage,
    automations,
    chooseWorkspace,
    clearSessionApprovalCache,
    configMessage,
    currentWorkspaceDisplay,
    oreCodeConfig,
    deepSeekApiKey,
    deepSeekBaseUrl,
    deepSeekModel,
    deepSeekModelMode,
    deepSeekThinkingLevel,
    deleteNote,
    doctorChecks,
    doctorMessage,
    doctorRunning,
    environmentInstallDialogOpen,
    environmentInstallPlan: environmentInstallPlanState,
    environmentInstallResults,
    environmentInstallRunning,
    durableTaskCount: durableTasks.length,
    durableTasks,
    effectiveProviderConfig,
    enableCacheWarmup: enableCacheWarmup || Boolean(oreCodeConfig?.context.enableCacheWarmup),
    enabledSkillCount,
    includeIdeContext,
    initMcpConfig,
    isRunning,
    loadDeepSeekApiKey,
    loadWorkspaceStatus,
    localePreference,
    mcpBusyLabel,
    mcpMessage,
    mcpSnapshot,
    mode,
    notes,
    noteMessage,
    openAutomationPanel,
    openSearchPanel,
    openSkillsPanel,
    permissionPreset,
    persistAppSettings,
    provider,
    providerError,
    providerOptions,
    providerTestMessage,
    recentWorkspacePaths,
    refreshAutomationWorkspace,
    refreshOreCodeConfig,
    refreshMcpTools,
    removeDeepSeekApiKey,
    runAgentTurn,
    buildEnvironmentInstallPlanForSettings,
    closeEnvironmentInstallDialog: () => setEnvironmentInstallDialogOpen(false),
    runDoctor,
    runEnvironmentInstallPlanFromSettings,
    runDueAutomations,
    saveDeepSeekApiKey,
    secretMessage,
    secretStatus,
    sessionApprovalCacheCount,
    sessionCount: sessions.length,
    setActiveSettingsSection,
    setDeepSeekApiKey,
    setDeepSeekBaseUrl,
    setDeepSeekModel,
    setDeepSeekModelMode,
    setDeepSeekThinkingLevel,
    setEnableCacheWarmup,
    setIncludeIdeContext,
    setLocalePreference,
    setMode,
    setPermissionPreset,
    setProvider,
    setSettingsQuery,
    setShowSettings,
    setThemePreference,
    setWorkspaceInput,
    settingsMessage,
    settingsQuery,
    skillsCount: skills.length,
    stopAllMcpServers,
    switchResourcePanel,
    testProviderConnection,
    themePreference,
    usageSummary,
    validateMcpConfig,
    visible: showSettings,
    workspaceInput,
    workspacePath
  });

  return (
    <ConfigProvider globalConfig={tdesignGlobalConfig}>
      <I18nProvider locale={resolvedLocale}>
      <main className={showInspector ? "workbench inspector-open" : "workbench"} style={workbenchStyle}>
      <AppSidebar
        expandedProjectPaths={expandedProjectPaths}
        filteredWorkspaceProjects={filteredWorkspaceProjects}
        onCloseWorkspacePanels={closeWorkspacePanels}
        onCommitRenameSession={commitRenameSession}
        onLoadSessionForWorkspace={(summary) => void loadSessionForWorkspace(summary)}
        onOpenAutomationPanel={openAutomationPanel}
        onOpenNewSessionDialog={openNewSessionDialog}
        onOpenSearchPanel={() => openSearchPanel()}
        onOpenSessionContextMenu={openSessionContextMenu}
        onOpenSettingsPanel={openSettingsPanel}
        onOpenSkillsPanel={openSkillsPanel}
        onRenameDraftChange={setRenameDraft}
        onRenamingThreadIdChange={setRenamingThreadId}
        onSearchQueryChange={setSidebarQuery}
        onSwitchWorkspaceProject={(path) => void switchWorkspaceProject(path)}
        onToggleWorkspaceProject={toggleWorkspaceProject}
        projectGroupsRef={projectGroupsRef}
        renameDraft={renameDraft}
        renamingThreadId={renamingThreadId}
        searchQuery={sidebarQuery}
        showAutomation={showAutomation}
        showSkills={showSkills}
        sidebarSessionCount={sidebarSessionCount}
        threadId={threadId}
      />

      <div
        aria-label={t("app.aria.resizeSidebar")}
        aria-orientation="vertical"
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuenow={sidebarWidth}
        className="panel-resize-handle sidebar-resize-handle"
        role="separator"
        onPointerDown={(event) => startPanelResize("sidebar", event)}
      />

      <section className="main-column">
        <AppTopbar
          conversationTitle={conversationTitle}
          currentWorkspaceLabel={currentWorkspaceLabel}
          eventsCount={events.length}
          onOpenSettings={openSettingsPanel}
          onOpenWorkspaceDialog={openNewSessionDialog}
          onThemePreferenceChange={setThemePreference}
          onToggleInspector={() => setShowInspector((visible) => !visible)}
          projectIndexStatus={projectIndexStatus}
          resolvedTheme={resolvedTheme}
          sessionMessage={sessionMessage}
          showInspector={showInspector}
          workspacePath={workspacePath}
        />

        <Transcript
          currentWorkspaceLabel={currentWorkspaceLabel}
          hasWorkspace={workspacePath !== "."}
          isRunning={isRunning}
          items={transcriptItems}
          loadingEarlier={loadingEarlierTranscript}
          messageFeedback={messageFeedback}
          onCopyMessage={(text) => void copyMessageText(text)}
          onExpandMessage={setExpandedMessage}
          onLoadEarlier={(gap) => void loadEarlierTranscript(gap)}
          onOpenArtifact={(artifactId) => {
            switchResourcePanel("Artifacts");
            void openArtifact(artifactId);
          }}
          onOpenWorkspaceDialog={openNewSessionDialog}
          onRunStarter={(prompt) => void runAgentTurn(prompt)}
          onToggleMessageFeedback={toggleMessageFeedback}
          scrollKey={threadId}
        >
          {visibleTaskChangeFileStats.length > 0 ? (
            <ChangeSummaryCard
              canUndoFile={canUndoChangeFile}
              files={visibleTaskChangeFileStats.map((file) => ({ ...file, group: "turn" as const }))}
              onReview={reviewChanges}
              onOpenFile={selectChangeFile}
              onCopyDiff={(path, group = "turn") => void copyChangeDiff(path, group)}
              onUndoFile={(path) => void undoChangeFile(path)}
              onUseInPrompt={useChangeInPrompt}
              onUndo={requestUndoChanges}
              diffPreview={changeDiffPreview}
              selectedGroup={selectedChangeGroup}
              selectedPath={selectedChangePath}
              totalAdditions={sumChangeStat(visibleTaskChangeFileStats, "additions")}
              totalDeletions={sumChangeStat(visibleTaskChangeFileStats, "deletions")}
            />
          ) : null}
          {activeTurnSkill ? (
            <div className="active-skill-line">
              <span>{t("app.skill.injected")}</span>
              <strong>{activeTurnSkill.name}</strong>
              <code>/{activeTurnSkill.id}</code>
            </div>
          ) : null}
        </Transcript>

        <ComposerBar
          attachments={composerAttachments}
          disabled={isRunning}
          hasWorkspace={workspacePath !== "."}
          includeIdeContext={includeIdeContext}
          isRunning={isRunning}
          modelLabel={modelLabel}
          deepSeekModelMode={effectiveDeepSeekModelMode}
          deepSeekThinkingLevel={deepSeekThinkingLevel}
          lastResolvedDeepSeekModel={lastResolvedDeepSeekModel?.resolvedModel}
          usageSummary={usageSummary}
          onAddAttachment={() => void addComposerAttachment()}
          onApplySkillSuggestion={applySkillSuggestion}
          onOpenContextInspector={() => switchResourcePanel("Usage")}
          onOpenSkills={openSkillsPanel}
          onOpenWorkspaceDialog={openNewSessionDialog}
          onProviderChange={(nextProvider) => setProvider(nextProvider as Provider)}
          onDeepSeekModelModeChange={setDeepSeekModelMode}
          onDeepSeekThinkingLevelChange={setDeepSeekThinkingLevel}
          onRemoveAttachment={removeComposerAttachment}
          onSend={(prompt) => void runAgentTurn(prompt)}
          onStop={stopAgentTurn}
          onSelectSlashCommand={selectSlashCommand}
          onToggleIdeContext={setIncludeIdeContext}
          onTogglePlanMode={togglePlanMode}
          permissionPreset={permissionPreset}
          planMode={mode === "plan"}
          promptText={promptText}
          provider={provider}
          providerOptions={providerOptions}
          setPermissionPreset={setPermissionPreset}
          setPromptText={setPromptText}
          skillSuggestions={skillSuggestions}
          slashCommands={availableSlashCommands}
        />
      </section>

      {showInspector ? (
        <>
        <div
          aria-label={t("app.aria.resizeInspector")}
          aria-orientation="vertical"
          aria-valuemax={INSPECTOR_MAX_WIDTH}
          aria-valuemin={INSPECTOR_MIN_WIDTH}
          aria-valuenow={inspectorWidth}
          className="panel-resize-handle inspector-resize-handle"
          role="separator"
          onPointerDown={(event) => startPanelResize("inspector", event)}
        />
        <InspectorPanel
          activePanel={activePanel}
          artifactMessage={artifactMessage}
          artifacts={artifacts}
          canUndoChangeFile={canUndoChangeFile}
          changeDiffPreview={changeDiffPreview}
          changeReviewFileCount={changeReviewFileCount}
          changeReviewGroups={changeReviewGroups}
          changesMessage={changesMessage}
          currentWorkspaceLabel={currentWorkspaceLabel}
          durableTasks={durableTasks}
          expandedChangeGroups={expandedChangeGroups}
          fileEntries={fileEntries}
          filePanelMessage={filePanelMessage}
          filePanelPath={filePanelPath}
          jobMessage={jobMessage}
          latestSubagentEvent={latestSubagentEvent}
          lightweightCommitMessage={lightweightCommitMessage}
          lightweightCommitMessageRunning={lightweightCommitMessageRunning}
          onCancelBackgroundShellJob={cancelBackgroundShellJob}
          onClose={() => setShowInspector(false)}
          onCopyChangeDiff={(path, group) => void copyChangeDiff(path, group)}
          onGoUpDirectory={() => void goUpDirectory()}
          onOpenArtifact={(id) => void openArtifact(id)}
          onOpenFileEntry={(entry) => void openFileEntry(entry)}
          onRefreshArtifacts={() => void refreshArtifacts()}
          onRefreshChanges={() => void refreshChanges()}
          onRefreshFiles={() => void refreshFiles()}
          onRefreshRuntimeShellJobs={() => void refreshRuntimeShellJobs()}
          onRefreshSkills={() => void refreshSkills()}
          onSelectChangeFile={(path, group) => void selectChangeFile(path, group)}
          onSetExpandedChangeGroups={setExpandedChangeGroups}
          onSetFilePanelPath={setFilePanelPath}
          onGenerateLightweightCommitMessage={() => void generateLightweightCommitMessageForChanges()}
          onStartBackgroundShellJob={() => void startBackgroundShellJob()}
          onToggleSkill={toggleSkill}
          onUndoChangeFile={(path) => void undoChangeFile(path)}
          onUseChangeInPrompt={useChangeInPrompt}
          onUseShellCommand={(command) => setPromptText(`运行 ${command}`)}
          onUseSkill={useSkill}
          runtimeShellJobs={runtimeShellJobs}
          selectedArtifact={selectedArtifact}
          selectedChangeFile={selectedChangeFile}
          selectedChangeGroup={selectedChangeGroup}
          selectedChangePath={selectedChangePath}
          shellJobs={shellJobs}
          skillErrors={skillErrors}
          skillMessage={skillMessage}
          skills={skills}
          totalReviewAdditions={totalReviewAdditions}
          totalReviewDeletions={totalReviewDeletions}
          usageSummary={usageSummary}
        />
        </>
      ) : null}

      <AppSettingsOverlay {...settingsOverlayProps} />

      {sessionContextMenu ? (
        <div className="context-menu-backdrop" onClick={() => setSessionContextMenu(null)}>
          <div
            className="session-context-menu"
            style={{ left: sessionContextMenu.x, top: sessionContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => beginRenameSession(sessionContextMenu.summary)}>{t("app.context.rename")}</button>
            <button type="button" onClick={() => void copySessionTitle(sessionContextMenu.summary.title)}>{t("app.context.copyTitle")}</button>
            <button className="danger" type="button" onClick={() => void removeSession(sessionContextMenu.summary)}>{t("app.context.deleteChat")}</button>
          </div>
        </div>
      ) : null}

      <SearchDialog
        currentThreadId={threadId}
        onClose={() => setShowSearch(false)}
        onOpenSession={(summary) => {
          setShowSearch(false);
          if (summary.threadId !== threadId) {
            void loadSessionForWorkspace(summary);
          }
        }}
        onQueryChange={setSearchQuery}
        query={searchQuery}
        results={searchResults}
        visible={showSearch}
      />
      <NewSessionDialog
        onChooseWorkspace={chooseWorkspace}
        onClose={() => setShowNewSession(false)}
        onCreate={startNewSession}
        onSelectRecentWorkspace={(path) => applyWorkspacePath(path)}
        recentWorkspacePaths={recentWorkspacePaths}
        visible={showNewSession}
        workspacePath={workspacePath}
      />
      <AutomationWorkspace
        automations={automations}
        busy={automationBusy}
        message={automationMessage}
        onClose={() => setShowAutomation(false)}
        onCreateAutomation={createAutomation}
        onDeleteAutomation={deleteAutomation}
        onRefresh={() => refreshAutomationWorkspace()}
        onRunAutomation={runAutomationNow}
        onRunDue={runDueAutomations}
        onToggleAutomation={toggleAutomation}
        tasks={durableTasks}
        visible={showAutomation}
      />
      <SkillsWorkspace
        errors={skillErrors}
        message={skillMessage}
        mcpBusyLabel={mcpBusyLabel}
        mcpMessage={mcpMessage}
        mcpSnapshot={mcpSnapshot}
        onAddMcpServer={(input) => void addMcpServer(input)}
        onCallMcpTool={(input) => callMcpTool(input)}
        onClose={() => setShowSkills(false)}
        onCreateSkill={createUserSkill}
        onInitMcp={() => void initMcpConfig()}
        onManageSkills={() => void openUserSkillRoot()}
        onRefresh={refreshSkills}
        onRefreshMcp={() => void refreshMcpTools(true)}
        onOpenSkillFolder={openUserSkillFolder}
        onReadMcpResource={(input) => readMcpResource(input)}
        onRenameSkill={renameUserSkill}
        onRemoveMcpServer={(name) => void removeMcpServer(name)}
        onSelectSkill={useSkill}
        onStopMcp={() => void stopAllMcpServers()}
        onTrashSkill={trashUserSkill}
        onUpdateSkill={updateUserSkill}
        onUseMcpPrompt={(input) => useMcpPrompt(input)}
        onToggleMcpServer={(name, enabled) => void toggleMcpServer(name, enabled)}
        onUpdateMcpServer={(input) => void updateMcpServer(input)}
        onToggleSkill={toggleSkill}
        onValidateMcp={() => void validateMcpConfig()}
        skills={skills}
        skillRootLabel={skillRootLabel}
        visible={showSkills}
      />
      <Dialog
        cancelBtn={null}
        confirmBtn={null}
        footer={false}
        header="回复全文"
        onClose={() => setExpandedMessage(null)}
        visible={Boolean(expandedMessage)}
        width={820}
      >
        {expandedMessage ? (
          <div className="expanded-message-dialog">
            <MarkdownView content={expandedMessage.text} />
          </div>
        ) : null}
      </Dialog>
      <ApprovalDialog
        formatPayload={formatToolPayload}
        onDecide={decideApproval}
        pendingApproval={pendingApproval}
        risk={pendingApprovalRisk}
        riskLevelText={riskLevelText}
        riskTagTheme={riskTagTheme}
      />
      <InteractionDialog
        onDecide={(decision) => void decideInteraction(decision)}
        request={pendingInteraction}
      />
      </main>
      </I18nProvider>
    </ConfigProvider>
  );
}

export default App;
