import { Button } from "tdesign-react";
import { CopyIcon } from "tdesign-icons-react";
import type { ToolCardState } from "../../features/tools/toolCards";
import type { RlmProgress } from "../../features/tools/rlmProgress";
import {
  formatToolPayload,
  toolCardPayload,
  type CommandOutputPreviewData,
  type MarkdownReadFile,
  type RetrievedArtifactSlice
} from "../../features/tools/toolPresentation";
import { MarkdownView } from "../MarkdownView";

export function CommandOutputPreview({ output }: { output: CommandOutputPreviewData }) {
  return (
    <section className="tool-command-output" aria-label="命令输出">
      <header>
        <strong>命令输出</strong>
        <span>
          {output.truncated ? "已保留尾部" : null}
          <Button
            aria-label="复制命令输出"
            icon={<CopyIcon size="13px" />}
            shape="square"
            size="small"
            type="button"
            variant="text"
            onClick={() => void copyText([output.stdout, output.stderr].filter(Boolean).join("\n"))}
          />
        </span>
      </header>
      {output.stdout ? (
        <div className="tool-command-stream">
          <span>
            stdout
            <button type="button" onClick={() => void copyText(output.stdout)}>复制</button>
          </span>
          <pre className="stdout" data-stream="stdout">{output.stdout}</pre>
        </div>
      ) : null}
      {output.stderr ? (
        <div className="tool-command-stream stderr">
          <span>
            stderr
            <button type="button" onClick={() => void copyText(output.stderr)}>复制</button>
          </span>
          <pre className="stderr" data-stream="stderr">{output.stderr}</pre>
        </div>
      ) : null}
    </section>
  );
}

export function ArtifactSlicePreview({ slice }: { slice: RetrievedArtifactSlice }) {
  return (
    <section className="tool-artifact-slice" aria-label="产物片段">
      <header>
        <span>
          <strong>{slice.artifactId}</strong>
          <small>{slice.stream} · {slice.mode}</small>
        </span>
        <em>
          {slice.returnedLines.start}-{slice.returnedLines.end} / {slice.totalLines} lines
        </em>
      </header>
      <pre>{slice.content}</pre>
      {slice.truncated || slice.charTruncated ? (
        <footer>
          {slice.truncated ? <span>行范围已截断</span> : null}
          {slice.charTruncated ? <span>字符数已截断</span> : null}
        </footer>
      ) : null}
    </section>
  );
}

export function RlmProgressPreview({ progress }: { progress: RlmProgress }) {
  return (
    <section className="tool-rlm-progress" aria-label="RLM 批任务进度">
      <header>
        <strong>RLM 批任务</strong>
        <span>{progress.completed}/{progress.total} 完成 · {progress.failed} 失败</span>
      </header>
      <div className="tool-rlm-progress-list">
        {progress.items.map((item) => (
          <div key={item.index} className={item.status}>
            <span>{item.index + 1}</span>
            <strong>{item.promptPreview}</strong>
            <small>
              {formatRlmStatus(item.status)}
              {item.durationMs !== undefined ? ` · ${item.durationMs}ms` : ""}
              {item.error ? ` · ${item.error}` : ""}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MarkdownFilePreview({ markdownFile }: { markdownFile: MarkdownReadFile }) {
  return (
    <div className="tool-markdown-preview">
      <header>
        <strong>{markdownFile.path}</strong>
        <span>Markdown preview</span>
      </header>
      <MarkdownView content={markdownFile.content} />
    </div>
  );
}

export function RawPayloadToggle({
  card,
  expanded,
  onToggle
}: {
  card: ToolCardState;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="tool-raw-payload">
      <button type="button" onClick={onToggle}>
        {expanded ? "收起原始工具结果" : "查看原始工具结果"}
      </button>
      {expanded ? (
        <pre>{formatToolPayload(toolCardPayload(card))}</pre>
      ) : null}
    </section>
  );
}

function formatRlmStatus(status: RlmProgress["items"][number]["status"]) {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}

async function copyText(text: string) {
  if (!text) {
    return;
  }

  await navigator.clipboard.writeText(text);
}
