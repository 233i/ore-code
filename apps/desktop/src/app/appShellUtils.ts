import type { RuntimeEvent } from "@seekforge/protocol";
import type { CommandRiskLevel } from "@seekforge/tools";
import type { ProjectIndexRefreshResult } from "../services/projectIndex";
import type { UiLocale } from "../services/uiLocale";
import { formatShortDateTime } from "../ui/InspectorPanel";
import type { ComposerAttachment } from "../ui/composerTypes";
import type { SettingsSection } from "../ui/settingsConfig";
import type { ProjectIndexStatus } from "./appTypes";

export function formatConversationRelativeTime(value: string, locale: UiLocale = "zh-CN") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return relativeLabel("justNow", locale);
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0 || diffMs < 60 * 1000) {
    return relativeLabel("justNow", locale);
  }

  if (isSameLocalDay(date, now)) {
    return relativeLabel("today", locale);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) {
    return relativeLabel("yesterday", locale);
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = startOfLocalDay(now).getTime();
  const startOfDate = startOfLocalDay(date).getTime();
  const dayDiff = Math.max(1, Math.floor((startOfToday - startOfDate) / dayMs));
  if (dayDiff < 30) {
    return relativeLabel("daysAgo", locale, dayDiff);
  }

  const monthDiff = (now.getFullYear() - date.getFullYear()) * 12 + now.getMonth() - date.getMonth();
  if (monthDiff < 12) {
    return relativeLabel("monthsAgo", locale, Math.max(1, monthDiff));
  }

  return relativeLabel("yearsAgo", locale, Math.max(1, now.getFullYear() - date.getFullYear()));
}

export function isSameLocalDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

export function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function riskLevelText(level: CommandRiskLevel) {
  switch (level) {
    case "read":
      return "只读命令";
    case "write":
      return "写入命令";
    case "dangerous":
      return "高风险命令";
    case "unknown":
      return "未知风险";
  }
}

export function riskTagTheme(level: CommandRiskLevel) {
  switch (level) {
    case "read":
      return "success";
    case "write":
      return "warning";
    case "dangerous":
      return "danger";
    case "unknown":
      return "default";
  }
}

export function normalizeSettingsSection(input: string): SettingsSection | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return "general";
  }

  const aliases: Record<string, SettingsSection> = {
    general: "general",
    providers: "providers",
    provider: "providers",
    model: "providers",
    permissions: "permissions",
    permission: "permissions",
    workspace: "workspace",
    doctor: "doctor",
    tools: "tools",
    mcp: "mcp",
    automation: "automation",
    automations: "automation",
    data: "data",
    sessions: "data",
    harness: "harness",
    about: "about"
  };

  return aliases[normalized] ?? null;
}

export function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function isImagePath(path: string) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);
}

export function dedupeAttachments(attachments: ComposerAttachment[]) {
  const byPath = new Map<string, ComposerAttachment>();
  for (const attachment of attachments) {
    byPath.set(attachment.path, attachment);
  }

  return [...byPath.values()];
}

export function createThreadId() {
  return `thread-${crypto.randomUUID()}`;
}

export function skillScanMessage(skillCount: number, errorCount: number) {
  if (skillCount === 0 && errorCount === 0) {
    return "未发现技能。";
  }

  if (errorCount > 0) {
    return `已加载 ${skillCount} 个技能，${errorCount} 个 SKILL.md 有问题。`;
  }

  return `已加载 ${skillCount} 个技能。`;
}

export function firstUserPrompt(events: RuntimeEvent[]) {
  const event = events.find((item) => item.type === "user_message");
  return event?.type === "user_message" ? event.text : null;
}

export function shouldRefreshProjectIndexForEvent(event: RuntimeEvent) {
  return event.type === "file_changed" || event.type === "snapshot_restored";
}

export function projectIndexStatusFromRefreshResult(result: ProjectIndexRefreshResult): ProjectIndexStatus {
  return {
    documentCount: result.documentCount,
    message: result.status === "ready"
      ? `已索引 ${result.documentCount} 个文件`
      : "未发现可索引文件",
    rebuiltDocuments: result.rebuiltDocuments,
    reusedDocuments: result.reusedDocuments,
    skippedDocuments: result.skippedDocuments,
    state: result.status,
    updatedAt: result.updatedAt
  };
}

export function projectIndexStatusLabel(status: ProjectIndexStatus, locale: UiLocale = "zh-CN") {
  switch (status.state) {
    case "indexing":
      return locale === "en-US"
        ? status.documentCount > 0 ? `Indexing ${status.documentCount}` : "Indexing"
        : status.documentCount > 0 ? `索引中 ${status.documentCount}` : "索引中";
    case "ready":
      return locale === "en-US" ? `Index ${status.documentCount}` : `索引 ${status.documentCount}`;
    case "empty":
      return locale === "en-US" ? "Not indexed" : "未索引";
    case "error":
      return locale === "en-US" ? "Index failed" : "索引失败";
    case "idle":
      return "";
  }
}

export function projectIndexStatusTitle(status: ProjectIndexStatus, locale: UiLocale = "zh-CN") {
  const parts = [status.message ?? projectIndexStatusLabel(status, locale)];
  if (status.reusedDocuments !== undefined || status.rebuiltDocuments !== undefined) {
    parts.push(locale === "en-US"
      ? `Reused ${status.reusedDocuments ?? 0}, updated ${status.rebuiltDocuments ?? 0}`
      : `复用 ${status.reusedDocuments ?? 0}，更新 ${status.rebuiltDocuments ?? 0}`);
  }
  if (status.skippedDocuments) {
    parts.push(locale === "en-US" ? `Skipped ${status.skippedDocuments}` : `跳过 ${status.skippedDocuments}`);
  }
  if (status.updatedAt) {
    parts.push(locale === "en-US" ? `Updated ${formatShortDateTime(status.updatedAt)}` : `更新时间 ${formatShortDateTime(status.updatedAt)}`);
  }
  return parts.filter(Boolean).join(" · ");
}

function relativeLabel(
  key: "daysAgo" | "justNow" | "monthsAgo" | "today" | "yearsAgo" | "yesterday",
  locale: UiLocale,
  count?: number
) {
  if (locale === "en-US") {
    switch (key) {
      case "justNow":
        return "Just now";
      case "today":
        return "Today";
      case "yesterday":
        return "Yesterday";
      case "daysAgo":
        return `${count} days ago`;
      case "monthsAgo":
        return `${count} months ago`;
      case "yearsAgo":
        return `${count} years ago`;
    }
  }

  switch (key) {
    case "justNow":
      return "刚刚";
    case "today":
      return "今天";
    case "yesterday":
      return "昨天";
    case "daysAgo":
      return `${count} 天前`;
    case "monthsAgo":
      return `${count} 个月前`;
    case "yearsAgo":
      return `${count} 年前`;
  }
}
