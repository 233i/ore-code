import { useEffect, useState } from "react";
import { Button, Tag, Textarea, Tooltip } from "tdesign-react";
import type { DeepSeekModelMode, ProviderThinkingLevel } from "@ore-code/agent-core";
import {
  AiTerminalIcon,
  ArrowUpIcon,
  ComponentGridIcon,
  FileAttachmentIcon,
  ToolsIcon
} from "tdesign-icons-react";
import type { ComposerAttachment } from "./composerTypes";
import type { SkillSuggestion } from "../services/skillRegistry";
import type { UsageSummary } from "../services/usageSummary";
import type { PermissionPreset } from "./permissionPreset";
import { ContextProgressButton } from "./ContextProgressButton";
import { PermissionMenu, ProviderMenu, type ProviderOption } from "./ComposerMenus";
import { ComposerPlusMenu } from "./ComposerPlusMenu";
import { SlashCommandPalette } from "./SlashCommandPalette";
import {
  completeSlashCommand,
  matchSlashCommands,
  shouldCompleteSlashCommand,
  type SlashCommand
} from "./slashCommands";

type ComposerBarProps = {
  attachments: ComposerAttachment[];
  disabled: boolean;
  includeIdeContext: boolean;
  hasWorkspace: boolean;
  isRunning: boolean;
  modelLabel: string;
  deepSeekModelMode: DeepSeekModelMode;
  deepSeekThinkingLevel: ProviderThinkingLevel;
  lastResolvedDeepSeekModel?: string;
  usageSummary: UsageSummary;
  onAddAttachment: () => void;
  onProviderChange: (provider: string) => void;
  onDeepSeekModelModeChange: (mode: DeepSeekModelMode) => void;
  onDeepSeekThinkingLevelChange: (level: ProviderThinkingLevel) => void;
  onRemoveAttachment: (id: string) => void;
  onSend: (prompt: string) => void;
  onStop: () => void;
  onToggleIdeContext: (value: boolean) => void;
  onTogglePlanMode: (value: boolean) => void;
  onOpenSkills: () => void;
  onOpenContextInspector: () => void;
  onOpenWorkspaceDialog: () => void;
  onApplySkillSuggestion: (skillId: string) => void;
  onSelectSlashCommand: (command: SlashCommand) => void;
  permissionPreset: PermissionPreset;
  planMode: boolean;
  promptText: string;
  provider: string;
  providerOptions: readonly ProviderOption[];
  setPermissionPreset: (preset: PermissionPreset) => void;
  setPromptText: (value: string) => void;
  skillSuggestions: SkillSuggestion[];
  slashCommands: SlashCommand[];
};

export function ComposerBar({
  attachments,
  disabled,
  hasWorkspace,
  includeIdeContext,
  isRunning,
  modelLabel,
  deepSeekModelMode,
  deepSeekThinkingLevel,
  lastResolvedDeepSeekModel,
  usageSummary,
  onAddAttachment,
  onProviderChange,
  onDeepSeekModelModeChange,
  onDeepSeekThinkingLevelChange,
  onRemoveAttachment,
  onSend,
  onStop,
  onToggleIdeContext,
  onTogglePlanMode,
  onOpenSkills,
  onOpenContextInspector,
  onOpenWorkspaceDialog,
  onApplySkillSuggestion,
  onSelectSlashCommand,
  permissionPreset,
  planMode,
  promptText,
  provider,
  providerOptions,
  setPermissionPreset,
  setPromptText,
  skillSuggestions,
  slashCommands
}: ComposerBarProps) {
  const matchedSlashCommands = matchSlashCommands(promptText, slashCommands);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const activeSlashCommand = matchedSlashCommands[Math.min(activeSlashIndex, matchedSlashCommands.length - 1)];
  const promptHasText = promptText.trim().length > 0;
  const isLocalSlashPrompt = promptText.trimStart().startsWith("/");
  const showSlashPalette = isLocalSlashPrompt && (matchedSlashCommands.length > 0 || promptText.trim().length > 1);

  const requestSend = () => {
    if (disabled) {
      return;
    }

    if (!hasWorkspace && !isLocalSlashPrompt && promptHasText) {
      onOpenWorkspaceDialog();
      return;
    }

    onSend(promptText);
  };

  useEffect(() => {
    setActiveSlashIndex(0);
  }, [promptText]);

  return (
    <footer className="composer">
      <div className="composer-shell">
        {attachments.length > 0 ? (
          <div className="composer-attachments" aria-label="已添加上下文附件">
            {attachments.map((attachment) => (
              <Tag
                closable
                key={attachment.id}
                maxWidth={260}
                onClose={() => onRemoveAttachment(attachment.id)}
                theme="default"
                variant="light"
              >
                <span className="composer-attachment-tag">
                  <FileAttachmentIcon size="14px" />
                  {attachment.name}
                </span>
              </Tag>
            ))}
          </div>
        ) : null}
        {skillSuggestions.length > 0 ? (
          <div className="skill-suggestion-row" aria-label="可用技能建议">
            {skillSuggestions.map((suggestion) => (
              <Tooltip content={suggestion.reason} key={suggestion.id}>
                <Button
                  className="skill-suggestion-chip"
                  icon={<ComponentGridIcon size="14px" />}
                  size="small"
                  type="button"
                  variant="outline"
                  onClick={() => onApplySkillSuggestion(suggestion.id)}
                >
                  使用 {suggestion.name}
                </Button>
              </Tooltip>
            ))}
          </div>
        ) : null}
        <Textarea
          aria-label="Prompt composer"
          autosize={{ minRows: 3, maxRows: 8 }}
          onChange={(value) => setPromptText(String(value))}
          onKeydown={(_value, { e: event }) => {
            const isComposing = Boolean(
              (event as unknown as { isComposing?: boolean }).isComposing ||
              (event.nativeEvent as KeyboardEvent | undefined)?.isComposing
            );

            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
              event.preventDefault();
              setPromptText("/");
              return;
            }

            if (showSlashPalette && event.key === "Escape") {
              event.preventDefault();
              setPromptText("");
              return;
            }

            if (matchedSlashCommands.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveSlashIndex((current) => (current + 1) % matchedSlashCommands.length);
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveSlashIndex((current) => (current - 1 + matchedSlashCommands.length) % matchedSlashCommands.length);
                return;
              }

              if (event.key === "Tab" && activeSlashCommand) {
                event.preventDefault();
                setPromptText(completeSlashCommand(activeSlashCommand));
                return;
              }

            }

            if (promptText.trimStart().startsWith("/") && event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (activeSlashCommand && shouldCompleteSlashCommand(promptText, activeSlashCommand)) {
                setPromptText(completeSlashCommand(activeSlashCommand));
                return;
              }

              requestSend();
              return;
            }

            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              requestSend();
              return;
            }

            if (event.key === "Enter" && !event.shiftKey && !isComposing) {
              event.preventDefault();
              requestSend();
            }
          }}
          placeholder={hasWorkspace ? "描述任务，按 Enter 发送..." : "先选择项目文件夹，再描述任务..."}
          value={promptText}
        />
        {showSlashPalette ? (
          <SlashCommandPalette
            activeIndex={activeSlashIndex}
            commands={matchedSlashCommands}
            onMouseEnter={setActiveSlashIndex}
            onSelect={onSelectSlashCommand}
          />
        ) : null}
        <div className="composer-toolbar" aria-label="Composer tools">
          <ComposerPlusMenu
            includeIdeContext={includeIdeContext}
            onAddAttachment={onAddAttachment}
            onOpenSkills={onOpenSkills}
            onToggleIdeContext={onToggleIdeContext}
            onTogglePlanMode={onTogglePlanMode}
            planMode={planMode}
          />
          <button
            aria-pressed={planMode}
            className={planMode ? "composer-mode-chip active" : "composer-mode-chip"}
            type="button"
            onClick={() => onTogglePlanMode(!planMode)}
          >
            <ToolsIcon size="14px" />
            <span>计划</span>
          </button>
          <button
            aria-pressed={includeIdeContext}
            className={includeIdeContext ? "composer-mode-chip active" : "composer-mode-chip"}
            type="button"
            onClick={() => onToggleIdeContext(!includeIdeContext)}
          >
            <AiTerminalIcon size="14px" />
            <span>IDE</span>
          </button>
          <PermissionMenu
            permissionPreset={permissionPreset}
            setPermissionPreset={setPermissionPreset}
          />
          <div className="composer-spacer" />
          <ContextProgressButton
            isRunning={isRunning}
            onOpenInspector={onOpenContextInspector}
            usageSummary={usageSummary}
          />
          <ProviderMenu
            deepSeekModelMode={deepSeekModelMode}
            deepSeekThinkingLevel={deepSeekThinkingLevel}
            lastResolvedDeepSeekModel={lastResolvedDeepSeekModel}
            modelLabel={modelLabel}
            onDeepSeekModelModeChange={onDeepSeekModelModeChange}
            onDeepSeekThinkingLevelChange={onDeepSeekThinkingLevelChange}
            onProviderChange={onProviderChange}
            provider={provider}
            providerOptions={providerOptions}
          />
          <Button
            aria-label={isRunning ? "停止" : "发送"}
            className="send-button"
            disabled={!isRunning && (disabled || !promptHasText)}
            icon={isRunning ? undefined : <ArrowUpIcon size="21px" />}
            shape="circle"
            type="button"
            variant="base"
            onClick={isRunning ? onStop : requestSend}
          >
            {isRunning ? "停止" : null}
          </Button>
        </div>
      </div>
    </footer>
  );
}
