import type { ComponentType } from "react";
import {
  AppIcon,
  CheckCircleFilledIcon,
  CodeIcon,
  CommandIcon,
  DashboardIcon,
  FolderIcon,
  HistoryIcon,
  PlayCircleIcon,
  SettingIcon,
  ToolsIcon
} from "tdesign-icons-react";
import type { TranslateFunction } from "../i18n/I18nProvider";
import type { TranslationKey } from "../i18n/messages";

export type TDesignIcon = ComponentType<{ size?: string | number }>;

export const settingsSections = [
  { id: "general", icon: SettingIcon, label: "常规", labelKey: "settings.section.general" },
  { id: "providers", icon: AppIcon, label: "模型与密钥", labelKey: "settings.section.providers" },
  { id: "permissions", icon: CheckCircleFilledIcon, label: "权限审批", labelKey: "settings.section.permissions" },
  { id: "workspace", icon: FolderIcon, label: "工作区", labelKey: "settings.section.workspace" },
  { id: "doctor", icon: DashboardIcon, label: "环境检测", labelKey: "settings.section.doctor" },
  { id: "tools", icon: ToolsIcon, label: "工具执行", labelKey: "settings.section.tools" },
  { id: "mcp", icon: CommandIcon, label: "MCP", labelKey: "settings.section.mcp" },
  { id: "automation", icon: DashboardIcon, label: "自动化", labelKey: "settings.section.automation" },
  { id: "data", icon: HistoryIcon, label: "会话与产物", labelKey: "settings.section.data" },
  { id: "harness", icon: PlayCircleIcon, label: "Harness 验收", labelKey: "settings.section.harness" },
  { id: "about", icon: CodeIcon, label: "关于 Ore Code", labelKey: "settings.section.about" }
] as const;

export type SettingsSection = (typeof settingsSections)[number]["id"];

export const isDeveloperHarnessEnabled = import.meta.env.DEV || import.meta.env.MODE === "test";

export const visibleSettingsSections = isDeveloperHarnessEnabled
  ? settingsSections
  : settingsSections.filter((section) => section.id !== "harness");

export const settingsNavGroups = [
  { label: "基础", labelKey: "settings.group.base", ids: ["general", "providers", "permissions", "workspace"] },
  { label: "能力", labelKey: "settings.group.capabilities", ids: ["doctor", "tools", "mcp", "automation", "harness"] },
  { label: "数据", labelKey: "settings.group.data", ids: ["data", "about"] }
] as const satisfies Array<{ label: string; labelKey: TranslationKey; ids: SettingsSection[] }>;

export const modeOptions = [
  { label: "计划模式", value: "plan" },
  { label: "Agent 审批", value: "agent" },
  { label: "完全访问权限", value: "yolo" }
] as const;

export const themeOptions = [
  { label: "跟随系统", value: "system" },
  { label: "浅色", value: "light" },
  { label: "深色", value: "dark" }
] as const;

export const localeOptions = [
  { label: "跟随系统", value: "system" },
  { label: "简体中文", value: "zh-CN" },
  { label: "English", value: "en-US" }
] as const;

export const permissionPresetOptions = [
  { label: "默认审批", value: "default" },
  { label: "自动审查", value: "autoReview" },
  { label: "完全访问权限", value: "fullAccess" }
] as const;

export function settingsSectionLabel(section: (typeof settingsSections)[number], t?: TranslateFunction) {
  return t ? t(section.labelKey as TranslationKey) : section.label;
}

export function settingsSectionMeta(section: SettingsSection, t?: TranslateFunction) {
  switch (section) {
    case "general":
      return {
        kicker: metaText("settings.meta.general.kicker", "应用偏好", t),
        title: metaText("settings.section.general", "常规", t),
        description: metaText("settings.meta.general.description", "设置默认 provider、外观、权限、工作区和 IDE 背景信息。", t)
      };
    case "providers":
      return {
        kicker: metaText("settings.meta.providers.kicker", "模型连接", t),
        title: metaText("settings.section.providers", "模型与密钥", t),
        description: metaText("settings.meta.providers.description", "配置 DeepSeek、OpenAI-compatible provider、API Key 和配置 overlay。", t)
      };
    case "permissions":
      return {
        kicker: metaText("settings.meta.permissions.kicker", "安全策略", t),
        title: metaText("settings.section.permissions", "权限审批", t),
        description: metaText("settings.meta.permissions.description", "控制 shell、文件写入和高风险工具调用的审批行为。", t)
      };
    case "workspace":
      return {
        kicker: metaText("settings.meta.workspace.kicker", "项目上下文", t),
        title: metaText("settings.section.workspace", "工作区", t),
        description: metaText("settings.meta.workspace.description", "决定文件、Git、shell、自动化和诊断默认运行在哪个项目路径下。", t)
      };
    case "doctor":
      return {
        kicker: metaText("settings.meta.doctor.kicker", "环境可用性", t),
        title: metaText("settings.section.doctor", "环境检测", t),
        description: metaText("settings.meta.doctor.description", "检查 Ore Code 可用的 shell、Git CLI、Node/npm、可选工具链和 provider 配置。", t)
      };
    case "tools":
      return {
        kicker: metaText("settings.meta.tools.kicker", "工具能力", t),
        title: metaText("settings.section.tools", "工具执行", t),
        description: metaText("settings.meta.tools.description", "查看内置工具、MCP、技能、LSP 和 Web 检索能力的入口。", t)
      };
    case "mcp":
      return {
        kicker: metaText("settings.meta.mcp.kicker", "外部工具", t),
        title: metaText("settings.section.mcp", "MCP", t),
        description: metaText("settings.meta.mcp.description", "管理 MCP 配置、连接状态、server 摘要和外部工具入口。", t)
      };
    case "automation":
      return {
        kicker: metaText("settings.meta.automation.kicker", "后台执行", t),
        title: metaText("settings.section.automation", "自动化", t),
        description: metaText("settings.meta.automation.description", "管理应用内调度、durable task 队列和后台执行状态。", t)
      };
    case "data":
      return {
        kicker: metaText("settings.meta.data.kicker", "本地状态", t),
        title: metaText("settings.section.data", "会话与产物", t),
        description: metaText("settings.meta.data.description", "管理会话、artifact、durable task、turn restore、usage 和容量状态。", t)
      };
    case "harness":
      return {
        kicker: metaText("settings.meta.harness.kicker", "验收流程", t),
        title: metaText("settings.section.harness", "Harness 验收", t),
        description: metaText("settings.meta.harness.description", "用 mock 或真实 provider smoke 流程确认 agent loop 是否稳定。", t)
      };
    case "about":
      return {
        kicker: metaText("settings.meta.about.kicker", "应用信息", t),
        title: metaText("settings.section.about", "关于 Ore Code", t),
        description: metaText("settings.meta.about.description", "查看桌面端运行环境、版本、技术栈和当前 provider。", t)
      };
  }
}

export function filterSettingsSections(
  query: string,
  sections: readonly (typeof settingsSections)[number][] = visibleSettingsSections,
  t?: TranslateFunction
) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return sections;
  }

  return sections.filter((section) => settingsSectionSearchText(section, t).includes(normalizedQuery));
}

function settingsSectionSearchText(section: (typeof settingsSections)[number], t?: TranslateFunction) {
  const meta = settingsSectionMeta(section.id, t);
  const keywords: Record<SettingsSection, string> = {
    general: "默认 provider 外观 主题 深色 浅色 权限 工作区 ide 背景",
    providers: "模型 密钥 api key deepseek model base url provider toml profile overlay",
    permissions: "权限 审批 shell 命令 plan agent yolo auto review 完全访问",
    workspace: "工作区 workspace 项目 路径 当前目录 最近项目",
    doctor: "检测 doctor git node npm pnpm cargo provider 环境",
    tools: "工具 mcp skill 技能 lsp diagnostics web search fetch shell git file",
    mcp: "mcp server tool resource prompt tdesign playwright github figma jsonl stdio 重连 校验 初始化",
    automation: "自动化 automation scheduled durable task queue 后台 运行 到期 调度 daemon",
    data: "会话 产物 artifact durable task automation restore snapshot token cost capacity",
    harness: "harness smoke mock provider 验收 测试",
    about: "关于 版本 tauri react typescript rust"
  };

  return normalizeSearchText([
    section.label,
    settingsSectionLabel(section, t),
    section.id,
    meta.kicker,
    meta.title,
    meta.description,
    keywords[section.id]
  ].join(" "));
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase();
}

function metaText(key: TranslationKey, fallback: string, t?: TranslateFunction) {
  return t ? t(key) : fallback;
}
