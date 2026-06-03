import { Button, Dialog, Input, Select, Tag } from "tdesign-react";
import type { AutomationRecord, DeepSeekModelMode, DeepSeekThinkingLevel, DurableTaskSnapshot, NoteRecord } from "@ore-code/agent-core";
import type { ThemePreference } from "../services/appSettings";
import type { UiLocalePreference } from "../services/uiLocale";
import type { ProviderConfig, ResolvedOreCodeConfig } from "../services/oreCodeConfig";
import { mcpConnectionSummary, type McpToolSnapshot } from "../services/mcpHost";
import { formatUsageInteger, type UsageSummary } from "../services/usageSummary";
import type { DoctorCheck } from "../services/workspaceDoctor";
import type { EnvironmentInstallPlan, EnvironmentInstallStepResult } from "../services/environmentInstallPlan";
import { formatWorkspacePathForDisplay } from "../services/workspacePath";
import type { Provider } from "../hooks/useProviderConfig";
import { localeOptions, modeOptions, permissionPresetOptions, themeOptions, type SettingsSection } from "./settingsConfig";
import type { AppMode, PermissionPreset } from "./permissionPreset";
import { deepSeekModelOptions } from "./deepSeekModelOptions";
import { deepSeekThinkingOptions } from "./deepSeekThinkingOptions";
import { useI18n, type TranslateFunction } from "../i18n/I18nProvider";

type ProviderOption = {
  label: string;
  value: string;
};

export type GeneralSettingsSectionProps = {
  enableCacheWarmup: boolean;
  includeIdeContext: boolean;
  localePreference: UiLocalePreference;
  mode: AppMode;
  onEnableCacheWarmupChange: (value: boolean) => void;
  onIncludeIdeContextChange: (value: boolean) => void;
  onLocalePreferenceChange: (locale: UiLocalePreference) => void;
  onModeChange: (mode: AppMode) => void;
  onProviderChange: (provider: Provider) => void;
  onSectionChange: (section: SettingsSection) => void;
  onThemePreferenceChange: (theme: ThemePreference) => void;
  provider: Provider;
  providerOptions: readonly ProviderOption[];
  themePreference: ThemePreference;
  workspacePath: string;
};

export function GeneralSettingsSection({
  enableCacheWarmup,
  includeIdeContext,
  localePreference,
  mode,
  onEnableCacheWarmupChange,
  onIncludeIdeContextChange,
  onLocalePreferenceChange,
  onModeChange,
  onProviderChange,
  onSectionChange,
  onThemePreferenceChange,
  provider,
  providerOptions,
  themePreference,
  workspacePath
}: GeneralSettingsSectionProps) {
  const { t } = useI18n();
  const localizedProviderOptions = [...providerOptions];
  const localizedThemeOptions = localizedOptions(themeOptions, t, {
    system: "settings.option.followSystem",
    light: "settings.option.light",
    dark: "settings.option.dark"
  });
  const localizedLocaleOptions = localizedOptions(localeOptions, t, {
    system: "settings.option.followSystem",
    "zh-CN": "settings.option.zhCN",
    "en-US": "settings.option.enUS"
  });
  const localizedModeOptions = localizedOptions(modeOptions, t, {
    plan: "settings.option.plan",
    agent: "settings.option.agent",
    yolo: "settings.option.fullAccess"
  });

  return (
    <>
      <h1>{t("settings.section.general")}</h1>
      <section className="settings-section">
        <h2>{t("settings.general.defaultBehavior")}</h2>
        <p>{t("settings.general.summary")}</p>
        <div className="settings-table">
          <div className="settings-row">
            <div>
              <strong>{t("settings.general.defaultProvider.title")}</strong>
              <p>{t("settings.general.defaultProvider.description")}</p>
            </div>
            <Select options={localizedProviderOptions} value={provider} onChange={(value) => onProviderChange(String(value) as Provider)} />
          </div>
          <div className="settings-row">
            <div>
              <strong>{t("settings.general.theme.title")}</strong>
              <p>{t("settings.general.theme.description")}</p>
            </div>
            <Select
              options={localizedThemeOptions}
              value={themePreference}
              onChange={(value) => onThemePreferenceChange(String(value) as ThemePreference)}
            />
          </div>
          <div className="settings-row">
            <div>
              <strong>{t("settings.general.language.title")}</strong>
              <p>{t("settings.general.language.description")}</p>
            </div>
            <Select
              options={localizedLocaleOptions}
              value={localePreference}
              onChange={(value) => onLocalePreferenceChange(String(value) as UiLocalePreference)}
            />
          </div>
          <div className="settings-row">
            <div>
              <strong>{t("settings.general.permission.title")}</strong>
              <p>{t("settings.general.permission.description")}</p>
            </div>
            <Select options={localizedModeOptions} value={mode} onChange={(value) => onModeChange(String(value) as AppMode)} />
          </div>
          <button className="settings-row row-button" type="button" onClick={() => onIncludeIdeContextChange(!includeIdeContext)}>
            <div>
              <strong>{t("settings.general.ideContext.title")}</strong>
              <p>{t("settings.general.ideContext.description")}</p>
            </div>
            <span className={includeIdeContext ? "switch active" : "switch"} />
          </button>
          <button className="settings-row row-button" type="button" onClick={() => onEnableCacheWarmupChange(!enableCacheWarmup)}>
            <div>
              <strong>{t("settings.general.cacheWarmup.title")}</strong>
              <p>{t("settings.general.cacheWarmup.description")}</p>
            </div>
            <span className={enableCacheWarmup ? "switch active" : "switch"} />
          </button>
          <div className="settings-row">
            <div>
              <strong>{t("settings.general.defaultWorkspace.title")}</strong>
              <p>{workspacePath === "." ? t("settings.general.defaultWorkspace.description.empty") : workspacePath}</p>
            </div>
            <Button className="secondary-pill" type="button" variant="base" onClick={() => onSectionChange("workspace")}>{t("app.action.manage")}</Button>
          </div>
        </div>
      </section>
    </>
  );
}

function localizedOptions<T extends { label: string; value: string }>(
  options: readonly T[],
  t: TranslateFunction,
  keys: Partial<Record<string, Parameters<TranslateFunction>[0]>>
) {
  return options.map((option) => {
    const key = keys[option.value];
    return {
      ...option,
      label: key ? t(key) : option.label
    };
  });
}

export type ProviderSettingsSectionProps = {
  configMessage: string | null;
  oreCodeConfig: ResolvedOreCodeConfig | null;
  deepSeekApiKey: string;
  deepSeekBaseUrl: string;
  deepSeekModel: string;
  deepSeekModelMode: DeepSeekModelMode;
  deepSeekThinkingLevel: DeepSeekThinkingLevel;
  effectiveProviderConfig: ProviderConfig | null;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onDeepSeekModelModeChange: (value: DeepSeekModelMode) => void;
  onDeepSeekThinkingLevelChange: (value: DeepSeekThinkingLevel) => void;
  onLoadApiKey: () => void | Promise<void>;
  onModelChange: (value: string) => void;
  onProviderChange: (provider: Provider) => void;
  onRefreshConfig: () => void | Promise<void>;
  onRemoveApiKey: () => void | Promise<void>;
  onSaveApiKey: () => void | Promise<void>;
  onTestProviderConnection: () => void | Promise<void>;
  provider: Provider;
  providerError: string | null;
  providerOptions: readonly ProviderOption[];
  providerTestMessage: string | null;
  secretMessage: string | null;
  secretStatusText: string;
};

export function ProviderSettingsSection({
  configMessage,
  oreCodeConfig,
  deepSeekApiKey,
  deepSeekBaseUrl,
  deepSeekModel,
  deepSeekModelMode,
  deepSeekThinkingLevel,
  effectiveProviderConfig,
  onApiKeyChange,
  onBaseUrlChange,
  onDeepSeekModelModeChange,
  onDeepSeekThinkingLevelChange,
  onLoadApiKey,
  onModelChange,
  onProviderChange,
  onRefreshConfig,
  onRemoveApiKey,
  onSaveApiKey,
  onTestProviderConnection,
  provider,
  providerError,
  providerOptions,
  providerTestMessage,
  secretMessage,
  secretStatusText
}: ProviderSettingsSectionProps) {
  const providerDisabled = provider === "mock";

  return (
    <>
      <h1>模型与密钥</h1>
      <section className="settings-section">
        <h2>Provider</h2>
        <div className="settings-table">
          <div className="settings-row">
            <div>
              <strong>当前 Provider</strong>
              <p>Mock 用于本地验收；配置文件可增加 OpenAI-compatible provider。</p>
            </div>
            <Select options={[...providerOptions]} value={provider} onChange={(value) => onProviderChange(String(value) as Provider)} />
          </div>
          <div className="settings-row">
            <div>
              <strong>API Key</strong>
              <p>保存到系统安全存储，不写入应用设置文件；也可用配置里的环境变量覆盖。</p>
            </div>
            <Input
              autocomplete="off"
              disabled={providerDisabled}
              onChange={(value) => onApiKeyChange(String(value))}
              type="password"
              value={deepSeekApiKey}
            />
          </div>
          <div className="settings-row compact-actions">
            <div>
              <strong>安全存储</strong>
              <p>{secretMessage ?? secretStatusText}</p>
            </div>
            <div className="settings-actions">
              <Button disabled={providerDisabled} type="button" variant="outline" onClick={() => void onSaveApiKey()}>保存</Button>
              <Button disabled={providerDisabled} type="button" variant="outline" onClick={() => void onLoadApiKey()}>读取</Button>
              <Button disabled={providerDisabled} type="button" variant="outline" onClick={() => void onRemoveApiKey()}>删除</Button>
              <Button disabled={providerDisabled} type="button" variant="outline" onClick={() => void onTestProviderConnection()}>测试连接</Button>
            </div>
          </div>
          {providerTestMessage || providerError ? (
            <p className={providerError ? "provider-error" : "provider-test"}>{providerError ?? providerTestMessage}</p>
          ) : null}
          <div className="settings-row">
            <div>
              <strong>模型模式</strong>
              <p>Auto 会按任务复杂度在 V4 Flash 和 V4 Pro 之间切换。</p>
            </div>
            <Select
              disabled={provider !== "deepseek"}
              options={deepSeekModelOptions.map((option) => ({ label: option.label, value: option.value }))}
              value={deepSeekModelMode}
              onChange={(value) => onDeepSeekModelModeChange(String(value) as DeepSeekModelMode)}
            />
          </div>
          <div className="settings-row">
            <div>
              <strong>高级模型名</strong>
              <p>保留给兼容和高级覆盖；官方 Pro/Flash 建议使用模型模式。</p>
            </div>
            <Input onChange={(value) => onModelChange(String(value))} value={deepSeekModel} />
          </div>
          <div className="settings-row">
            <div>
              <strong>思考等级</strong>
              <p>仅 DeepSeek V4 thinking 请求生效；关闭适合低延迟，高和最强适合复杂编码。</p>
            </div>
            <Select
              disabled={provider !== "deepseek"}
              options={deepSeekThinkingOptions.map((option) => ({ label: option.label, value: option.value }))}
              value={deepSeekThinkingLevel}
              onChange={(value) => onDeepSeekThinkingLevelChange(String(value) as DeepSeekThinkingLevel)}
            />
          </div>
          <div className="settings-row">
            <div>
              <strong>Base URL</strong>
              <p>DeepSeek OpenAI-compatible API 地址。</p>
            </div>
            <Input onChange={(value) => onBaseUrlChange(String(value))} value={deepSeekBaseUrl} />
          </div>
          <div className="settings-row compact-actions">
            <div>
              <strong>配置 overlay</strong>
              <p>{configMessage ?? "读取 ~/.ore-code/config.toml 和项目 .ore-code/config.toml。"}</p>
            </div>
            <div className="settings-actions">
              <Button type="button" variant="outline" onClick={() => void onRefreshConfig()}>刷新配置</Button>
            </div>
          </div>
          {oreCodeConfig ? (
            <div className="config-source-list">
              <div>
                <strong>Profile</strong>
                <span>{oreCodeConfig.activeProfile}</span>
              </div>
              <div>
                <strong>Provider</strong>
                <span>{effectiveProviderConfig?.label ?? provider}</span>
              </div>
              {oreCodeConfig.sources.map((source) => (
                <div key={`${source.scope}:${source.path}`}>
                  <strong>{source.scope}</strong>
                  <span>{source.status} · {source.path}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

export type PermissionsSettingsSectionProps = {
  mode: AppMode;
  onClearSessionApprovalCache: () => void;
  onModeChange: (mode: AppMode) => void;
  onPermissionPresetChange: (preset: PermissionPreset) => void;
  permissionPreset: PermissionPreset;
  sessionApprovalCacheCount: number;
};

export function PermissionsSettingsSection({
  mode,
  onClearSessionApprovalCache,
  onModeChange,
  onPermissionPresetChange,
  permissionPreset,
  sessionApprovalCacheCount
}: PermissionsSettingsSectionProps) {
  return (
    <>
      <h1>权限审批</h1>
      <section className="settings-section">
        <h2>Agent 模式</h2>
        <p>Ore Code 的高风险能力围绕工具审批设计，尤其是 shell 命令和文件写入。</p>
        <div className="settings-table">
          <div className="settings-row">
            <div>
              <strong>默认权限模式</strong>
              <p>Plan 可在审批或完全访问下执行；Agent 按风险审批；完全访问减少弹窗。</p>
            </div>
            <Select options={[...modeOptions]} value={mode} onChange={(value) => onModeChange(String(value) as AppMode)} />
          </div>
          <div className="settings-row">
            <div>
              <strong>审批预设</strong>
              <p>默认按风险审批；自动审查会放行低风险操作，必要时弹窗确认；完全访问直接执行。</p>
            </div>
            <Select
              options={[...permissionPresetOptions]}
              value={permissionPreset}
              onChange={(value) => onPermissionPresetChange(String(value) as PermissionPreset)}
            />
          </div>
          <button className="settings-row row-button" type="button" onClick={() => onModeChange("agent")}>
            <div>
              <strong>shell 命令审批</strong>
              <p>exec_shell 默认需要审批，命令在当前 workspace 内执行。</p>
            </div>
            <span className={mode === "agent" ? "switch active" : "switch"} />
          </button>
          <button className="settings-row row-button" type="button" onClick={() => onModeChange("yolo")}>
            <div>
              <strong>完全访问权限</strong>
              <p>适合你明确知道风险的本地项目，默认不建议长期开启。</p>
            </div>
            <span className={mode === "yolo" ? "switch active" : "switch"} />
          </button>
          <div className="settings-row">
            <div>
              <strong>本会话审批缓存</strong>
              <p>当前记住 {sessionApprovalCacheCount} 个审批。缓存只在本次应用会话内有效，可随时撤销。</p>
            </div>
            <Button disabled={sessionApprovalCacheCount === 0} type="button" variant="outline" onClick={onClearSessionApprovalCache}>清空缓存</Button>
          </div>
        </div>
      </section>
    </>
  );
}

export type WorkspaceSettingsSectionProps = {
  currentWorkspaceLabel: string;
  onApplyWorkspacePath: (path?: string) => void | Promise<void>;
  onChooseWorkspace: () => void | Promise<void>;
  onLoadWorkspaceStatus: () => void | Promise<void>;
  onPersistSettings: () => void | Promise<void>;
  onWorkspaceInputChange: (value: string) => void;
  recentWorkspacePaths: string[];
  sameWorkspacePath: (left: string, right: string) => boolean;
  settingsMessage: string | null;
  workspaceInput: string;
  workspacePath: string;
  workspaceProjectName: (workspacePath: string) => string;
};

export function WorkspaceSettingsSection({
  currentWorkspaceLabel,
  onApplyWorkspacePath,
  onChooseWorkspace,
  onLoadWorkspaceStatus,
  onPersistSettings,
  onWorkspaceInputChange,
  recentWorkspacePaths,
  sameWorkspacePath,
  settingsMessage,
  workspaceInput,
  workspacePath,
  workspaceProjectName
}: WorkspaceSettingsSectionProps) {
  return (
    <>
      <h1>工作区</h1>
      <section className="settings-section">
        <h2>默认工作区</h2>
        <p>文件工具、Git 工具、shell 命令都会被限制在这个 workspace 下。</p>
        <div className="settings-table">
          <div className="settings-row">
            <div>
              <strong>当前路径</strong>
              <p>{currentWorkspaceLabel}</p>
            </div>
            <Input onChange={(value) => onWorkspaceInputChange(String(value))} value={workspaceInput} />
          </div>
          <div className="settings-row compact-actions">
            <div>
              <strong>工作区操作</strong>
              <p>{settingsMessage ?? "选择或保存默认工作区。"}</p>
            </div>
            <div className="settings-actions">
              <Button type="button" variant="outline" onClick={() => void onLoadWorkspaceStatus()}>使用当前目录</Button>
              <Button type="button" variant="outline" onClick={() => void onChooseWorkspace()}>选择工作区</Button>
              <Button type="button" variant="outline" onClick={() => void onApplyWorkspacePath()}>应用路径</Button>
              <Button type="button" variant="outline" onClick={() => void onPersistSettings()}>保存设置</Button>
            </div>
          </div>
          <div className="settings-row settings-row-stack">
            <div>
              <strong>最近项目</strong>
              <p>从侧边栏和新对话里使用过的 workspace 会保留在这里，方便切换默认项目。</p>
            </div>
            <div className="settings-chip-list">
              {recentWorkspacePaths.length > 0 ? recentWorkspacePaths.map((path) => (
                <button
                  className={sameWorkspacePath(path, workspacePath) ? "active" : ""}
                  key={path}
                  title={formatWorkspacePathForDisplay(path)}
                  type="button"
                  onClick={() => void onApplyWorkspacePath(path)}
                >
                  <strong>{workspaceProjectName(path)}</strong>
                  <small>{formatWorkspacePathForDisplay(path)}</small>
                </button>
              )) : <span>暂无最近项目</span>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export type DoctorSettingsSectionProps = {
  checks: DoctorCheck[];
  installDialogOpen: boolean;
  installPlan: EnvironmentInstallPlan | null;
  installResults: EnvironmentInstallStepResult[];
  installRunning: boolean;
  message: string | null;
  onBuildInstallPlan: () => unknown;
  onCloseInstallDialog: () => void;
  onRunDoctor: () => unknown;
  onRunInstallPlan: () => unknown;
  running: boolean;
};

export function DoctorSettingsSection({
  checks,
  installDialogOpen,
  installPlan,
  installResults,
  installRunning,
  message,
  onBuildInstallPlan,
  onCloseInstallDialog,
  onRunDoctor,
  onRunInstallPlan,
  running
}: DoctorSettingsSectionProps) {
  const resultByStep = new Map(installResults.map((result) => [result.stepId, result]));
  const canRunInstallPlan = Boolean(installPlan?.executableStepCount) && !installRunning;

  return (
    <>
      <h1>环境检测</h1>
      <section className="settings-section">
        <h2>Ore Code 运行环境</h2>
        <p>检查 Ore Code 可用的 shell、Git CLI、Node/npm、可选工具链和 provider 配置，不判断当前目录是否为项目仓库。</p>
        <div className="settings-table">
          <div className="settings-row compact-actions">
            <div>
              <strong>环境检测</strong>
              <p>{message ?? "运行检测前只会执行轻量版本命令，不会修改项目文件。"}</p>
            </div>
            <div className="settings-actions">
              <Button disabled={running} loading={running} type="button" variant="outline" onClick={() => void onRunDoctor()}>
                {running ? "检测中" : "运行检测"}
              </Button>
              <Button
                disabled={running || installRunning}
                loading={installRunning}
                type="button"
                variant="outline"
                onClick={() => void onBuildInstallPlan()}
              >
                修复环境
              </Button>
            </div>
          </div>
          <div className="doctor-list">
            {checks.length > 0 ? (
              checks.map((check) => (
                <div className="doctor-row" key={check.id}>
                  <span className={`doctor-status ${check.status}`}>{doctorStatusText(check.status)}</span>
                  <div>
                    <div className="doctor-title">
                      <strong>{check.label}</strong>
                      <span>{doctorCategoryText(check.category)}</span>
                      <span>{doctorRequiredLevelText(check.requiredLevel)}</span>
                    </div>
                    <p>{check.detail}</p>
                    {check.installHint ? <small>{check.installHint}</small> : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="doctor-empty">尚未运行环境检测。</p>
            )}
          </div>
        </div>
      </section>
      <Dialog
        cancelBtn="关闭"
        className="environment-install-dialog"
        confirmBtn={canRunInstallPlan ? "确认执行" : null}
        confirmLoading={installRunning}
        header="修复环境"
        placement="center"
        visible={installDialogOpen}
        width={720}
        onClose={onCloseInstallDialog}
        onConfirm={() => void onRunInstallPlan()}
      >
        <div className="environment-install-body">
          <p>{installPlan?.message ?? "先运行一次检测，再生成修复计划。"}</p>
          {installPlan?.steps.length ? (
            <div className="environment-install-list">
              {installPlan.steps.map((step) => {
                const result = resultByStep.get(step.id);
                return (
                  <article className="environment-install-step" key={step.id}>
                    <header>
                      <div>
                        <strong>{step.title}</strong>
                        <span>{installCategoryText(step.category)}</span>
                        <span className={`environment-risk ${step.risk}`}>{installRiskText(step.risk)}</span>
                      </div>
                      <span className={`environment-step-status ${result?.status ?? "pending"}`}>
                        {installStepStatusText(result?.status ?? "pending")}
                      </span>
                    </header>
                    <p>{step.description}</p>
                    {step.command ? <code>{[step.command.program, ...step.command.args].join(" ")}</code> : null}
                    {step.manualHint ? <small>{step.manualHint}</small> : null}
                    {result?.error ? <small className="environment-install-error">{result.error}</small> : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="doctor-empty">当前没有可执行的修复步骤。</p>
          )}
        </div>
      </Dialog>
    </>
  );
}

export type ToolsSettingsSectionProps = {
  enabledSkillCount: number;
  mcpSnapshot: McpToolSnapshot | null;
  onOpenMcp: () => void;
  onOpenResourcePanel: (panel: "Files" | "Changes" | "Jobs") => void;
  skillsCount: number;
};

export function ToolsSettingsSection({
  enabledSkillCount,
  mcpSnapshot,
  onOpenMcp,
  onOpenResourcePanel,
  skillsCount
}: ToolsSettingsSectionProps) {
  return (
    <>
      <h1>工具执行</h1>
      <section className="settings-section">
        <h2>内置工具</h2>
        <div className="settings-table">
          <div className="settings-row">
            <div>
              <strong>文件工具</strong>
              <p>列目录、读取文件、写入文件，浏览器预览下返回 unsupported。</p>
            </div>
            <Button className="secondary-pill" type="button" variant="base" onClick={() => onOpenResourcePanel("Files")}>打开文件面板</Button>
          </div>
          <div className="settings-row">
            <div>
              <strong>Git 工具</strong>
              <p>读取 status 和 diff，用于变更摘要与审核。</p>
            </div>
            <Button className="secondary-pill" type="button" variant="base" onClick={() => onOpenResourcePanel("Changes")}>打开变更面板</Button>
          </div>
          <div className="settings-row">
            <div>
              <strong>shell 工具</strong>
              <p>cwd 固定为 workspace；默认 30 秒超时；stdout/stderr 会截断。</p>
            </div>
            <Button className="secondary-pill" type="button" variant="base" onClick={() => onOpenResourcePanel("Jobs")}>打开任务面板</Button>
          </div>
          <div className="settings-row">
            <div>
              <strong>MCP 工具</strong>
              <p>{mcpSnapshot ? `${mcpSnapshot.servers.length} 个 server，${mcpSnapshot.tools.length} 个 tool，${mcpSnapshot.resources.length} 个 resource。` : "管理外部 MCP server、tool、resource 和 prompt。"}</p>
            </div>
            <Button className="secondary-pill" type="button" variant="base" onClick={onOpenMcp}>打开 MCP</Button>
          </div>
          <div className="settings-row">
            <div>
              <strong>技能系统</strong>
              <p>{enabledSkillCount}/{skillsCount} 个技能已启用；禁用项会从 slash command 和自动建议中移除。</p>
            </div>
            <Button className="secondary-pill" type="button" variant="base" onClick={onOpenMcp}>管理技能</Button>
          </div>
          <div className="settings-row">
            <div>
              <strong>LSP Diagnostics</strong>
              <p>编辑后可调用 rust-analyzer、tsserver、pyright、gopls、clangd 等诊断工具。</p>
            </div>
            <Tag variant="light">已内置</Tag>
          </div>
          <div className="settings-row">
            <div>
              <strong>Web 工具</strong>
              <p>提供 DuckDuckGo Lite 搜索和 URL 抓取，用于基础网页检索。</p>
            </div>
            <Tag variant="light">已内置</Tag>
          </div>
        </div>
      </section>
    </>
  );
}

export type McpSettingsSectionProps = {
  busyLabel: string | null;
  message: string | null;
  onInitConfig: () => void | Promise<void>;
  onOpenMcp: () => void;
  onReconnect: () => void | Promise<void>;
  onStopAll: () => void | Promise<void>;
  onValidateConfig: () => void | Promise<void>;
  snapshot: McpToolSnapshot | null;
};

export function McpSettingsSection({
  busyLabel,
  message,
  onInitConfig,
  onOpenMcp,
  onReconnect,
  onStopAll,
  onValidateConfig,
  snapshot
}: McpSettingsSectionProps) {
  const busy = Boolean(busyLabel);

  return (
    <>
      <h1>MCP</h1>
      <section className="settings-section">
        <h2>服务器与外部工具</h2>
        <p>MCP 用于把外部工具、资源和 prompt 接入 Ore Code。这里提供配置状态和安全操作入口。</p>
        <div className="settings-table">
          <div className="settings-row compact-actions">
            <div>
              <strong>连接状态</strong>
              <p>{busyLabel ?? message ?? mcpConnectionSummary(snapshot)}</p>
            </div>
            <div className="settings-actions mcp-settings-actions">
              <Button loading={busy} type="button" variant="outline" onClick={() => void onReconnect()}>重连</Button>
              <Button disabled={busy} type="button" variant="outline" onClick={() => void onValidateConfig()}>校验</Button>
              <Button disabled={busy} type="button" variant="outline" onClick={() => void onInitConfig()}>初始化</Button>
              <Button disabled={busy} type="button" variant="outline" onClick={() => void onStopAll()}>停止全部</Button>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <strong>配置文件</strong>
              <p>{snapshot?.configPath ?? "~/.ore-code/mcp.json"}</p>
            </div>
            <Button className="secondary-pill" type="button" variant="base" onClick={onOpenMcp}>打开 MCP 管理</Button>
          </div>
          <div className="settings-row settings-row-stack">
            <div>
              <strong>Server 摘要</strong>
              <p>{snapshot ? `${snapshot.servers.length} 个 server，${snapshot.tools.length} 个 tool，${snapshot.resources.length} 个 resource，${snapshot.prompts.length} 个 prompt。` : "MCP 尚未加载。"}</p>
            </div>
            <div className="settings-status-list">
              {snapshot && snapshot.servers.length > 0 ? snapshot.servers.map((server) => (
                <div key={server.name}>
                  <span className={`settings-status-dot ${server.status}`} />
                  <strong>{server.name}</strong>
                  <small>{server.status} · {server.toolCount} tools · {server.resourceCount} resources · {server.promptCount} prompts</small>
                </div>
              )) : <p>暂无 MCP server。可以在 MCP 页面添加 TDesign、Playwright、GitHub 等 server。</p>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export type AutomationSettingsSectionProps = {
  automations: AutomationRecord[];
  busy: boolean;
  durableTasks: DurableTaskSnapshot[];
  formatDateTime: (value: string) => string;
  message: string | null;
  onOpenAutomation: () => void;
  onRefresh: () => void | Promise<void>;
  onRunDue: () => void | Promise<void>;
};

export function AutomationSettingsSection({
  automations,
  busy,
  durableTasks,
  formatDateTime,
  message,
  onOpenAutomation,
  onRefresh,
  onRunDue
}: AutomationSettingsSectionProps) {
  const activeAutomationCount = automations.filter((automation) => automation.status === "active").length;
  const pausedAutomationCount = automations.filter((automation) => automation.status === "paused").length;
  const activeTaskCount = durableTasks.filter((task) => task.status === "queued" || task.status === "running").length;
  const failedTaskCount = durableTasks.filter((task) => task.status === "failed").length;

  return (
    <>
      <h1>自动化</h1>
      <section className="settings-section">
        <h2>后台任务与调度</h2>
        <p>自动化当前是应用内调度；Ore Code 运行时会处理到期项和 durable task executor。</p>
        <div className="settings-table">
          <div className="settings-row compact-actions">
            <div>
              <strong>运行状态</strong>
              <p>{message ?? `${automations.length} 个自动化，${durableTasks.length} 个持久任务。`}</p>
            </div>
            <div className="settings-actions">
              <Button disabled={busy} loading={busy} type="button" variant="outline" onClick={() => void onRefresh()}>刷新</Button>
              <Button disabled={busy} type="button" variant="outline" onClick={() => void onRunDue()}>运行到期项</Button>
              <Button className="secondary-pill" type="button" variant="base" onClick={onOpenAutomation}>打开自动化</Button>
            </div>
          </div>
          <div className="settings-row settings-row-stack">
            <div>
              <strong>定时自动化</strong>
              <p>{activeAutomationCount} 个运行中，{pausedAutomationCount} 个已暂停。</p>
            </div>
            <div className="settings-status-list">
              {automations.length > 0 ? automations.slice(0, 6).map((automation) => (
                <div key={automation.id}>
                  <span className={`settings-status-dot ${automation.status}`} />
                  <strong>{automation.name}</strong>
                  <small>{automation.status} · {automation.nextRunAt ? `下次 ${formatDateTime(automation.nextRunAt)}` : "未计划"}</small>
                </div>
              )) : <p>暂无自动化。可以在自动化页面创建周期性任务。</p>}
            </div>
          </div>
          <div className="settings-row settings-row-stack">
            <div>
              <strong>Durable Task</strong>
              <p>{activeTaskCount} 个队列/运行中任务，{failedTaskCount} 个失败任务。</p>
            </div>
            <div className="settings-status-list">
              {durableTasks.length > 0 ? durableTasks.slice(0, 6).map((task) => (
                <div key={task.id}>
                  <span className={`settings-status-dot ${task.status}`} />
                  <strong>{task.title}</strong>
                  <small>{task.status} · {formatDateTime(task.updatedAt)}</small>
                </div>
              )) : <p>暂无 durable task。Agent 创建长期任务后会显示在这里。</p>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export type DataSettingsSectionProps = {
  artifactCount: number;
  automationCount: number;
  durableTaskCount: number;
  notes: NoteRecord[];
  noteMessage: string | null;
  onDeleteNote: (id: string) => void;
  onOpenAutomation: () => void;
  onOpenResourcePanel: (panel: "Artifacts" | "Changes" | "Usage") => void;
  onOpenSearch: () => void;
  sessionCount: number;
  usageSummary: UsageSummary;
};

export function DataSettingsSection({
  artifactCount,
  automationCount,
  durableTaskCount,
  notes,
  noteMessage,
  onDeleteNote,
  onOpenAutomation,
  onOpenResourcePanel,
  onOpenSearch,
  sessionCount,
  usageSummary
}: DataSettingsSectionProps) {
  return (
    <>
      <h1>会话与产物</h1>
      <section className="settings-section">
        <h2>本地数据</h2>
        <div className="settings-table">
          <div className="settings-row">
            <div>
              <strong>会话历史</strong>
              <p>当前已记录 {sessionCount} 个会话摘要。</p>
            </div>
            <Button className="secondary-pill" type="button" variant="base" onClick={onOpenSearch}>搜索会话</Button>
          </div>
          <div className="settings-row">
            <div>
              <strong>产物记录</strong>
              <p>当前已记录 {artifactCount} 个 agent 产物。</p>
            </div>
            <Button className="secondary-pill" type="button" variant="base" onClick={() => onOpenResourcePanel("Artifacts")}>查看产物</Button>
          </div>
          <div className="settings-row">
            <div>
              <strong>持久任务与自动化</strong>
              <p>{automationCount} 个自动化，{durableTaskCount} 个 durable task。应用运行时执行，不是系统 daemon。</p>
            </div>
            <Button className="secondary-pill" type="button" variant="base" onClick={onOpenAutomation}>打开自动化</Button>
          </div>
          <div className="settings-row">
            <div>
              <strong>Turn Restore / Snapshot</strong>
              <p>每轮变更可生成快照，用于审查和恢复本轮文件改动。</p>
            </div>
            <Button className="secondary-pill" type="button" variant="base" onClick={() => onOpenResourcePanel("Changes")}>查看变更</Button>
          </div>
	          <div className="settings-row">
	            <div>
	              <strong>Token / Capacity</strong>
	              <p>{formatUsageInteger(usageSummary.totalTokens)} tokens，容量守卫会在上下文过大时裁剪。</p>
	            </div>
	            <Button className="secondary-pill" type="button" variant="base" onClick={() => onOpenResourcePanel("Usage")}>查看用量</Button>
	          </div>
	          <div className="settings-row settings-row-stack">
	            <div>
	              <strong>Agent 记忆</strong>
	              <p>{noteMessage ?? `${notes.length} 条记忆`}。模型只应记录偏好、决策、长期 blocker 和架构约束。</p>
	            </div>
	            <div className="settings-status-list">
	              {notes.length > 0 ? notes.slice(0, 8).map((note) => (
	                <div key={note.id}>
	                  <span className="settings-status-dot ACTIVE" />
	                  <strong>{note.kind}</strong>
	                  <small>{note.text}</small>
	                  <Button size="small" type="button" variant="text" onClick={() => onDeleteNote(note.id)}>删除</Button>
	                </div>
	              )) : <p>暂无 agent 记忆。</p>}
	            </div>
	          </div>
	        </div>
      </section>
    </>
  );
}

export type HarnessSettingsSectionProps = {
  isRunning: boolean;
  onRunMockSmoke: () => unknown;
  onTestProviderConnection: () => unknown;
  provider: Provider;
};

export function HarnessSettingsSection({
  isRunning,
  onRunMockSmoke,
  onTestProviderConnection,
  provider
}: HarnessSettingsSectionProps) {
  return (
    <>
      <h1>Harness 验收</h1>
      <section className="settings-section">
        <h2>Smoke 流程</h2>
        <p>用稳定场景验证 agent loop、工具卡片、审批和产物链路是否正常。</p>
        <div className="settings-table">
          <div className="settings-row">
            <div>
              <strong>Mock Harness Smoke</strong>
              <p>不依赖真实模型，适合快速确认 UI 和工具循环。</p>
            </div>
            <Button className="secondary-pill" disabled={isRunning} loading={isRunning} type="button" variant="base" onClick={() => void onRunMockSmoke()}>
              {isRunning ? "运行中" : "运行"}
            </Button>
          </div>
          <div className="settings-row">
            <div>
              <strong>Provider Smoke</strong>
              <p>在 DeepSeek API Key 配置后，用真实模型连接测试。</p>
            </div>
            <Button className="secondary-pill" disabled={provider !== "deepseek"} type="button" variant="base" onClick={() => void onTestProviderConnection()}>测试连接</Button>
          </div>
        </div>
      </section>
    </>
  );
}

export type AboutSettingsSectionProps = {
  providerText: string;
  runtimeText: string;
};

export function AboutSettingsSection({ providerText, runtimeText }: AboutSettingsSectionProps) {
  return (
    <>
      <h1>关于 Ore Code</h1>
      <section className="settings-section">
        <h2>桌面端</h2>
        <div className="settings-table">
          <div className="settings-row">
            <div>
              <strong>技术栈</strong>
              <p>Tauri + React + TypeScript + Rust command boundary。</p>
            </div>
            <span>0.1.0 MVP</span>
          </div>
          <div className="settings-row">
            <div>
              <strong>当前运行环境</strong>
              <p>{runtimeText}</p>
            </div>
            <span>{providerText}</span>
          </div>
        </div>
      </section>
    </>
  );
}

function doctorStatusText(status: DoctorCheck["status"]) {
  if (status === "pass") return "通过";
  if (status === "warn") return "提醒";
  if (status === "fail") return "失败";
  return "信息";
}

function doctorCategoryText(category: DoctorCheck["category"]) {
  if (category === "core") return "核心";
  if (category === "toolchain") return "工具链";
  if (category === "project") return "项目";
  if (category === "provider") return "模型";
  return "环境";
}

function doctorRequiredLevelText(level: DoctorCheck["requiredLevel"]) {
  if (level === "required") return "必需";
  if (level === "recommended") return "推荐";
  if (level === "optional") return "可选";
  return "检测";
}

function installCategoryText(category: EnvironmentInstallPlan["steps"][number]["category"]) {
  if (category === "core") return "核心";
  if (category === "toolchain") return "工具链";
  if (category === "project") return "项目";
  if (category === "provider") return "模型";
  return "环境";
}

function installRiskText(risk: EnvironmentInstallPlan["steps"][number]["risk"]) {
  if (risk === "high") return "高影响";
  if (risk === "medium") return "需确认";
  return "低风险";
}

function installStepStatusText(status: EnvironmentInstallStepResult["status"] | "pending") {
  if (status === "succeeded") return "完成";
  if (status === "failed") return "失败";
  if (status === "skipped") return "手动";
  if (status === "running") return "执行中";
  return "待执行";
}
