import type { DeepSeekModelMode, DeepSeekThinkingLevel, NoteRecord } from "@ore-code/agent-core";
import type { ResolvedOreCodeConfig, ProviderConfig } from "../services/oreCodeConfig";
import { isTauriRuntime } from "../services/fileHost";
import type { McpToolSnapshot } from "../services/mcpHost";
import type { UsageSummary } from "../services/usageSummary";
import type { DoctorCheck } from "../services/workspaceDoctor";
import type { EnvironmentInstallPlan, EnvironmentInstallStepResult } from "../services/environmentInstallPlan";
import type { ThemePreference } from "../services/appSettings";
import type { UiLocalePreference } from "../services/uiLocale";
import { formatShortDateTime } from "../ui/InspectorPanel";
import type { AppMode, PermissionPreset } from "../ui/permissionPreset";
import { isDeveloperHarnessEnabled, type SettingsSection } from "../ui/settingsConfig";
import { providerLabel, secretRuntimeText, type Provider } from "../hooks/useProviderConfig";
import { sameWorkspacePath, workspaceProjectName } from "../hooks/useWorkspaceProjects";
import type { AppSettingsOverlayProps } from "./AppSettingsOverlay";
import type { Panel } from "./appTypes";

type ProviderOption = {
  label: string;
  value: string;
};

type UseSettingsOverlayPropsInput = {
  activeSettingsSection: SettingsSection;
  artifactsCount: number;
  automationBusy: boolean;
  automationMessage: string | null;
  automationCount: number;
  automations: AppSettingsOverlayProps["automation"]["automations"];
  clearSessionApprovalCache: () => void;
  configMessage: string | null;
  currentWorkspaceDisplay: string;
  oreCodeConfig: ResolvedOreCodeConfig | null;
  deepSeekApiKey: string;
  deepSeekBaseUrl: string;
  deepSeekModel: string;
  deepSeekModelMode: DeepSeekModelMode;
  deepSeekThinkingLevel: DeepSeekThinkingLevel;
  doctorChecks: DoctorCheck[];
  environmentInstallDialogOpen: boolean;
  environmentInstallPlan: EnvironmentInstallPlan | null;
  environmentInstallResults: EnvironmentInstallStepResult[];
  environmentInstallRunning: boolean;
  doctorMessage: string | null;
  doctorRunning: boolean;
  durableTaskCount: number;
  durableTasks: AppSettingsOverlayProps["automation"]["durableTasks"];
  effectiveProviderConfig: ProviderConfig | null;
  enableCacheWarmup: boolean;
  enabledSkillCount: number;
  includeIdeContext: boolean;
  isRunning: boolean;
  loadDeepSeekApiKey: () => void | Promise<void>;
  loadWorkspaceStatus: () => void | Promise<void>;
  localePreference: UiLocalePreference;
  mcpBusyLabel: string | null;
  mcpMessage: string | null;
  mcpSnapshot: McpToolSnapshot | null;
  mode: AppMode;
  notes: NoteRecord[];
  noteMessage: string | null;
  openAutomationPanel: () => void;
  openSearchPanel: () => void;
  openSkillsPanel: () => void;
  permissionPreset: PermissionPreset;
  persistAppSettings: () => void | Promise<void>;
  provider: Provider;
  providerError: string | null;
  providerOptions: readonly ProviderOption[];
  providerTestMessage: string | null;
  recentWorkspacePaths: string[];
  refreshAutomationWorkspace: () => void | Promise<void>;
  refreshOreCodeConfig: (workspacePath: string) => void | Promise<unknown>;
  refreshMcpTools: (force?: boolean) => unknown;
  removeDeepSeekApiKey: () => void | Promise<void>;
  runAgentTurn: (prompt: string) => void | Promise<void>;
  buildEnvironmentInstallPlanForSettings: () => void | Promise<void>;
  closeEnvironmentInstallDialog: () => void;
  runDoctor: () => unknown;
  runEnvironmentInstallPlanFromSettings: () => void | Promise<void>;
  runDueAutomations: () => void | Promise<void>;
  saveDeepSeekApiKey: () => void | Promise<void>;
  secretMessage: string | null;
  secretStatus: Parameters<typeof secretRuntimeText>[0];
  sessionApprovalCacheCount: number;
  sessionCount: number;
  setActiveSettingsSection: (section: SettingsSection) => void;
  setDeepSeekApiKey: (value: string) => void;
  setDeepSeekBaseUrl: (value: string) => void;
  setDeepSeekModel: (value: string) => void;
  setDeepSeekModelMode: (value: DeepSeekModelMode) => void;
  setDeepSeekThinkingLevel: (value: DeepSeekThinkingLevel) => void;
  setEnableCacheWarmup: (value: boolean) => void;
  setIncludeIdeContext: (value: boolean) => void;
  setLocalePreference: (value: UiLocalePreference) => void;
  setMode: (mode: AppMode) => void;
  setPermissionPreset: (preset: PermissionPreset) => void;
  setProvider: (provider: Provider) => void;
  setSettingsQuery: (query: string) => void;
  setShowSettings: (visible: boolean) => void;
  setThemePreference: (value: ThemePreference) => void;
  setWorkspaceInput: (value: string) => void;
  settingsMessage: string | null;
  settingsQuery: string;
  skillsCount: number;
  stopAllMcpServers: () => void | Promise<void>;
  switchResourcePanel: (panel: Panel) => void;
  testProviderConnection: () => void | Promise<void>;
  themePreference: ThemePreference;
  usageSummary: UsageSummary;
  validateMcpConfig: () => void | Promise<void>;
  workspaceInput: string;
  workspacePath: string;
  applyWorkspacePath: (path?: string) => void | Promise<void>;
  chooseWorkspace: () => void | Promise<void>;
  deleteNote: (id: string) => void | Promise<void>;
  initMcpConfig: () => void | Promise<void>;
  visible: boolean;
};

export function useSettingsOverlayProps(input: UseSettingsOverlayPropsInput): AppSettingsOverlayProps {
  const closeSettings = () => input.setShowSettings(false);
  const openAutomationFromSettings = () => {
    input.openAutomationPanel();
    closeSettings();
  };
  const openMcpFromSettings = () => {
    input.openSkillsPanel();
    closeSettings();
  };
  const openResourcePanelFromSettings = (panel: Panel) => {
    input.switchResourcePanel(panel);
    closeSettings();
  };

  return {
    about: {
      providerText: providerLabel(input.provider),
      runtimeText: isTauriRuntime() ? "Tauri Desktop" : "Browser Preview"
    },
    activeSection: input.activeSettingsSection,
    automation: {
      automations: input.automations,
      busy: input.automationBusy,
      durableTasks: input.durableTasks,
      formatDateTime: formatShortDateTime,
      message: input.automationMessage,
      onOpenAutomation: openAutomationFromSettings,
      onRefresh: input.refreshAutomationWorkspace,
      onRunDue: input.runDueAutomations
    },
    data: {
      artifactCount: input.artifactsCount,
      automationCount: input.automationCount,
      durableTaskCount: input.durableTaskCount,
      notes: input.notes,
      noteMessage: input.noteMessage,
      onDeleteNote: (id) => void input.deleteNote(id),
      onOpenAutomation: openAutomationFromSettings,
      onOpenResourcePanel: (panel) => openResourcePanelFromSettings(panel),
      onOpenSearch: () => {
        input.openSearchPanel();
        closeSettings();
      },
      sessionCount: input.sessionCount,
      usageSummary: input.usageSummary
    },
    doctor: {
      checks: input.doctorChecks,
      installDialogOpen: input.environmentInstallDialogOpen,
      installPlan: input.environmentInstallPlan,
      installResults: input.environmentInstallResults,
      installRunning: input.environmentInstallRunning,
      message: input.doctorMessage,
      onBuildInstallPlan: input.buildEnvironmentInstallPlanForSettings,
      onCloseInstallDialog: input.closeEnvironmentInstallDialog,
      onRunDoctor: input.runDoctor,
      onRunInstallPlan: input.runEnvironmentInstallPlanFromSettings,
      running: input.doctorRunning
    },
    general: {
      enableCacheWarmup: input.enableCacheWarmup,
      includeIdeContext: input.includeIdeContext,
      localePreference: input.localePreference,
      mode: input.mode,
      onEnableCacheWarmupChange: input.setEnableCacheWarmup,
      onIncludeIdeContextChange: input.setIncludeIdeContext,
      onLocalePreferenceChange: input.setLocalePreference,
      onModeChange: input.setMode,
      onProviderChange: input.setProvider,
      onSectionChange: input.setActiveSettingsSection,
      onThemePreferenceChange: input.setThemePreference,
      provider: input.provider,
      providerOptions: input.providerOptions,
      themePreference: input.themePreference,
      workspacePath: input.workspacePath
    },
    harness: {
      isRunning: input.isRunning,
      onRunMockSmoke: () => {
        closeSettings();
        void input.runAgentTurn("列出当前工作区");
      },
      onTestProviderConnection: input.testProviderConnection,
      provider: input.provider
    },
    mcp: {
      busyLabel: input.mcpBusyLabel,
      message: input.mcpMessage,
      onInitConfig: input.initMcpConfig,
      onOpenMcp: openMcpFromSettings,
      onReconnect: async () => {
        await Promise.resolve(input.refreshMcpTools(true));
      },
      onStopAll: input.stopAllMcpServers,
      onValidateConfig: input.validateMcpConfig,
      snapshot: input.mcpSnapshot
    },
    onActiveSectionChange: input.setActiveSettingsSection,
    onClose: closeSettings,
    onQueryChange: input.setSettingsQuery,
    onSave: input.persistAppSettings,
    permissions: {
      mode: input.mode,
      onClearSessionApprovalCache: input.clearSessionApprovalCache,
      onModeChange: input.setMode,
      onPermissionPresetChange: input.setPermissionPreset,
      permissionPreset: input.permissionPreset,
      sessionApprovalCacheCount: input.sessionApprovalCacheCount
    },
    providers: {
      configMessage: input.configMessage,
      oreCodeConfig: input.oreCodeConfig,
      deepSeekApiKey: input.deepSeekApiKey,
      deepSeekBaseUrl: input.deepSeekBaseUrl,
      deepSeekModel: input.deepSeekModel,
      deepSeekModelMode: input.deepSeekModelMode,
      deepSeekThinkingLevel: input.deepSeekThinkingLevel,
      effectiveProviderConfig: input.effectiveProviderConfig,
      onApiKeyChange: input.setDeepSeekApiKey,
      onBaseUrlChange: input.setDeepSeekBaseUrl,
      onDeepSeekModelModeChange: input.setDeepSeekModelMode,
      onDeepSeekThinkingLevelChange: input.setDeepSeekThinkingLevel,
      onLoadApiKey: input.loadDeepSeekApiKey,
      onModelChange: input.setDeepSeekModel,
      onProviderChange: input.setProvider,
      onRefreshConfig: async () => {
        await input.refreshOreCodeConfig(input.workspacePath);
      },
      onRemoveApiKey: input.removeDeepSeekApiKey,
      onSaveApiKey: input.saveDeepSeekApiKey,
      onTestProviderConnection: input.testProviderConnection,
      provider: input.provider,
      providerError: input.providerError,
      providerOptions: input.providerOptions,
      providerTestMessage: input.providerTestMessage,
      secretMessage: input.secretMessage,
      secretStatusText: secretRuntimeText(input.secretStatus)
    },
    query: input.settingsQuery,
    showHarness: isDeveloperHarnessEnabled,
    tools: {
      enabledSkillCount: input.enabledSkillCount,
      mcpSnapshot: input.mcpSnapshot,
      onOpenMcp: openMcpFromSettings,
      onOpenResourcePanel: (panel) => openResourcePanelFromSettings(panel),
      skillsCount: input.skillsCount
    },
    visible: input.visible,
    workspace: {
      currentWorkspaceLabel: input.currentWorkspaceDisplay,
      onApplyWorkspacePath: input.applyWorkspacePath,
      onChooseWorkspace: input.chooseWorkspace,
      onLoadWorkspaceStatus: input.loadWorkspaceStatus,
      onPersistSettings: input.persistAppSettings,
      onWorkspaceInputChange: input.setWorkspaceInput,
      recentWorkspacePaths: input.recentWorkspacePaths,
      sameWorkspacePath,
      settingsMessage: input.settingsMessage,
      workspaceInput: input.workspaceInput,
      workspacePath: input.workspacePath,
      workspaceProjectName
    }
  };
}
