import { useState } from "react";
import { Button } from "tdesign-react";
import { CopyIcon } from "tdesign-icons-react";
import type { ToolCardState } from "../features/tools/toolCards";
import { deriveRlmProgressForToolCard } from "../features/tools/rlmProgress";
import {
  getCommandOutput,
  getMarkdownReadFile,
  getRetrievedArtifactSlice,
  getShellCommand,
  getToolDisplayName,
  getToolHumanSummary,
  toolStatusText
} from "../features/tools/toolPresentation";
import {
  ArtifactSlicePreview,
  CommandOutputPreview,
  MarkdownFilePreview,
  RawPayloadToggle,
  RlmProgressPreview
} from "./tool-card/ToolCardPreviews";

export { formatToolPayload } from "../features/tools/toolPresentation";

type ToolCardProps = {
  card: ToolCardState;
  onOpenArtifact: (artifactId: string) => void;
};

export function ToolCard({ card, onOpenArtifact }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);
  const markdownFile = getMarkdownReadFile(card);
  const rlmProgress = deriveRlmProgressForToolCard(card);
  const commandOutput = rlmProgress ? null : getCommandOutput(card);
  const artifactSlice = getRetrievedArtifactSlice(card);
  const shellCommand = getShellCommand(card);
  const toolSummary = getToolHumanSummary(card);
  const toolDisplayName = getToolDisplayName(card);

  return (
    <section className={`tool-card transcript-event ${card.status}`}>
      <button className="event-row-button" type="button" onClick={() => setExpanded((current) => !current)}>
        <span className="tool-card-heading">
          <span className={`tool-status-dot ${card.status}`} aria-hidden="true" />
          <span className="tool-name">{toolDisplayName}</span>
          <span className="tool-id">{toolSummary}</span>
        </span>
        <span className={`tool-status-text ${card.status}`}>
          {toolStatusText(card.status)} · {expanded ? "收起" : "展开"}
        </span>
      </button>
      {expanded ? (
        <div className="tool-card-body">
          <p className="tool-action-summary">{toolSummary}</p>
          {shellCommand ? <ShellCommandSummary command={shellCommand} /> : null}
          {card.approvalDecision ? <p className="tool-approval">审批：{card.approvalDecision}</p> : null}
          {card.result?.artifactId ? (
            <Button size="small" type="button" variant="outline" onClick={() => onOpenArtifact(card.result?.artifactId ?? "")}>
              打开完整产物
            </Button>
          ) : null}
          {rlmProgress ? <RlmProgressPreview progress={rlmProgress} /> : null}
          {commandOutput ? <CommandOutputPreview output={commandOutput} /> : null}
          {artifactSlice ? <ArtifactSlicePreview slice={artifactSlice} /> : null}
          {markdownFile ? <MarkdownFilePreview markdownFile={markdownFile} /> : null}
          <RawPayloadToggle card={card} expanded={rawExpanded} onToggle={() => setRawExpanded((current) => !current)} />
        </div>
      ) : null}
    </section>
  );
}

function ShellCommandSummary({ command }: { command: string }) {
  return (
    <section className="tool-command-summary" aria-label="命令摘要">
      <span>command</span>
      <code>{command}</code>
      <Button
        aria-label="复制命令"
        icon={<CopyIcon size="14px" />}
        shape="square"
        size="small"
        type="button"
        variant="text"
        onClick={() => void copyText(command)}
      />
    </section>
  );
}

async function copyText(text: string) {
  if (!text) {
    return;
  }

  await navigator.clipboard.writeText(text);
}
