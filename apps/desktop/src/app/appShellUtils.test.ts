import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dedupeAttachments,
  formatConversationRelativeTime,
  normalizeSettingsSection,
  shouldRefreshProjectIndexAfterIndexedAt
} from "./appShellUtils";
import type { ComposerAttachment } from "../ui/composerTypes";
import type { RuntimeEvent } from "@ore-code/protocol";

describe("formatConversationRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats invalid and same-day dates as compact Chinese labels", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T12:00:00+08:00"));

    expect(formatConversationRelativeTime("not-a-date")).toBe("刚刚");
    expect(formatConversationRelativeTime("2026-05-26T09:00:00+08:00")).toBe("今天");
  });

  it("formats yesterday and older dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T12:00:00+08:00"));

    expect(formatConversationRelativeTime("2026-05-25T23:00:00+08:00")).toBe("昨天");
    expect(formatConversationRelativeTime("2026-05-20T09:00:00+08:00")).toBe("6 天前");
  });

  it("formats relative dates in English when requested", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T12:00:00+08:00"));

    expect(formatConversationRelativeTime("not-a-date", "en-US")).toBe("Just now");
    expect(formatConversationRelativeTime("2026-05-26T09:00:00+08:00", "en-US")).toBe("Today");
    expect(formatConversationRelativeTime("2026-05-25T23:00:00+08:00", "en-US")).toBe("Yesterday");
    expect(formatConversationRelativeTime("2026-05-20T09:00:00+08:00", "en-US")).toBe("6 days ago");
  });
});

describe("normalizeSettingsSection", () => {
  it("normalizes common English aliases", () => {
    expect(normalizeSettingsSection("")).toBe("general");
    expect(normalizeSettingsSection("provider")).toBe("providers");
    expect(normalizeSettingsSection("automations")).toBe("automation");
    expect(normalizeSettingsSection("unknown")).toBeNull();
  });
});

describe("shouldRefreshProjectIndexAfterIndexedAt", () => {
  it("ignores historical file events that are older than the current index", () => {
    expect(shouldRefreshProjectIndexAfterIndexedAt(
      runtimeEvent("file_changed", "2026-06-04T08:00:00.000Z"),
      "2026-06-04T09:00:00.000Z"
    )).toBe(false);
  });

  it("refreshes for file events newer than the current index", () => {
    expect(shouldRefreshProjectIndexAfterIndexedAt(
      runtimeEvent("file_changed", "2026-06-04T10:00:00.000Z"),
      "2026-06-04T09:00:00.000Z"
    )).toBe(true);
  });

  it("does not refresh without an indexed timestamp", () => {
    expect(shouldRefreshProjectIndexAfterIndexedAt(
      runtimeEvent("file_changed", "2026-06-04T10:00:00.000Z"),
      undefined
    )).toBe(false);
  });
});

describe("dedupeAttachments", () => {
  it("keeps the last attachment for duplicate paths", () => {
    const attachments: ComposerAttachment[] = [
      { id: "a", kind: "file", name: "first.ts", path: "/tmp/file.ts" },
      { id: "b", kind: "file", name: "second.ts", path: "/tmp/file.ts" },
      { id: "c", kind: "image", name: "image.png", path: "/tmp/image.png" }
    ];

    expect(dedupeAttachments(attachments)).toEqual([
      { id: "b", kind: "file", name: "second.ts", path: "/tmp/file.ts" },
      { id: "c", kind: "image", name: "image.png", path: "/tmp/image.png" }
    ]);
  });
});

function runtimeEvent(type: "file_changed" | "snapshot_restored" | "assistant_message", createdAt: string): RuntimeEvent {
  return {
    id: "event-1",
    seq: 1,
    threadId: "thread-1",
    turnId: "turn-1",
    createdAt,
    type
  } as RuntimeEvent;
}
