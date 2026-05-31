import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { basename, dedupeAttachments, isImagePath } from "./appShellUtils";
import { isTauriRuntime } from "../services/fileHost";
import type { ComposerAttachment, MessageFeedback } from "../ui/composerTypes";
import { completeSlashCommand, type SlashCommand } from "../ui/slashCommands";
import type { TranscriptMessage } from "../ui/Transcript";

export function useSessionActions({ setSessionMessage }: {
  setSessionMessage: (message: string | null) => void;
}) {
  const [promptText, setPromptText] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [messageFeedback, setMessageFeedback] = useState<Record<string, MessageFeedback>>({});
  const [expandedMessage, setExpandedMessage] = useState<TranscriptMessage | null>(null);

  async function addComposerAttachment() {
    if (!isTauriRuntime()) {
      setSessionMessage("浏览器预览不能选择本地文件；请在 Tauri 桌面端添加照片和文件。");
      return;
    }

    const selected = await open({ multiple: true, title: "添加照片和文件到上下文" });
    const paths = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
    if (paths.length === 0) {
      return;
    }

    const nextAttachments = paths.map((path) => ({
      id: crypto.randomUUID(),
      name: basename(path),
      path,
      kind: isImagePath(path) ? "image" as const : "file" as const
    }));
    setComposerAttachments((current) => dedupeAttachments([...current, ...nextAttachments]));
    setSessionMessage(`已添加 ${nextAttachments.length} 个上下文附件。`);
  }

  function removeComposerAttachment(id: string) {
    setComposerAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function toggleMessageFeedback(messageId: string, feedback: Exclude<MessageFeedback, null>) {
    setMessageFeedback((current) => ({
      ...current,
      [messageId]: current[messageId] === feedback ? null : feedback
    }));
  }

  async function copyMessageText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setSessionMessage("已复制回复。");
    } catch (error) {
      setSessionMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function selectSlashCommand(command: SlashCommand) {
    setPromptText(completeSlashCommand(command));
  }

  function applySkillSuggestion(skillId: string) {
    const trimmedPrompt = promptText.trim();
    setPromptText(`/${skillId}${trimmedPrompt ? ` ${trimmedPrompt}` : " "}`);
  }

  return {
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
  };
}
