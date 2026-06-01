import { useState } from "react";
import { Button, Dialog, Input, Tag } from "tdesign-react";
import { AiIcon, AiTerminalIcon, ArrowLeftIcon, ArrowRightUpIcon, CopyIcon, EditIcon, RefreshIcon, RollbackIcon } from "tdesign-icons-react";
import type { DurableTaskSnapshot } from "@ore-code/agent-core";
import type { ArtifactMetadata, ArtifactRecord, RuntimeEvent } from "@ore-code/protocol";
import { changeGroupLabel, type ChangeGroup, type ChangeReviewGroup, type ChangeReviewItem } from "../features/changes/changeGroups";
import type { ShellJobState } from "../features/jobs/shellJobs";
import type { SkillRecord, SkillScanError } from "../services/skillRegistry";
import type { ShellJobRecord } from "../services/shellHost";
import type { LightweightReviewResult } from "../services/lightweightCompletion";
import type { UsageSummary } from "../services/usageSummary";
import { DiffView, LightweightReviewBlock } from "./ChangeSummaryCard";
import { ContextInspectorPanel } from "./ContextInspectorPanel";
import { CurrentTaskPanel, selectCurrentTask } from "./CurrentTaskPanel";
import { SkillList } from "./SkillList";

export type InspectorPanelKind = "Files" | "Changes" | "Jobs" | "Skills" | "Artifacts" | "Usage";

type FileEntry = {
  isDir: boolean;
  name: string;
  path: string;
};

export type InspectorPanelProps = {
  activePanel: InspectorPanelKind;
  artifactMessage: string | null;
  artifacts: ArtifactMetadata[];
  canUndoChangeFile: (path: string) => boolean;
  changeDiffPreview: string;
  changeReviewFileCount: number;
  changeReviewGroups: ChangeReviewGroup[];
  changesMessage: string | null;
  currentWorkspaceLabel: string;
  durableTasks: DurableTaskSnapshot[];
  expandedChangeGroups: Record<ChangeGroup, boolean>;
  fileEntries: FileEntry[];
  filePanelMessage: string | null;
  filePanelPath: string;
  jobMessage: string | null;
  latestSubagentEvent: Extract<RuntimeEvent, { type: "subagent_completed" }> | null;
  lightweightCommitMessage: LightweightReviewResult | null;
  lightweightCommitMessageRunning: boolean;
  onCancelBackgroundShellJob: (jobId: string) => void;
  onClose: () => void;
  onCopyChangeDiff: (path: string, group: ChangeGroup) => void;
  onGoUpDirectory: () => void;
  onOpenArtifact: (id: string) => void;
  onOpenFileEntry: (entry: FileEntry) => void;
  onRefreshArtifacts: () => void;
  onRefreshChanges: () => void;
  onRefreshFiles: () => void;
  onRefreshRuntimeShellJobs: () => void;
  onRefreshSkills: () => void;
  onSelectChangeFile: (path: string, group: ChangeGroup) => void;
  onSetExpandedChangeGroups: (updater: (current: Record<ChangeGroup, boolean>) => Record<ChangeGroup, boolean>) => void;
  onSetFilePanelPath: (path: string) => void;
  onGenerateLightweightCommitMessage: () => void;
  onStartBackgroundShellJob: () => void;
  onToggleSkill: (skillId: string, enabled: boolean) => void;
  onUndoChangeFile: (path: string) => void;
  onUseChangeInPrompt: (path: string, group: ChangeGroup) => void;
  onUseShellCommand: (command: string) => void;
  onUseSkill: (skill: SkillRecord) => void;
  runtimeShellJobs: ShellJobRecord[];
  selectedArtifact: ArtifactRecord | null;
  selectedChangeFile: ChangeReviewItem | null;
  selectedChangeGroup: ChangeGroup;
  selectedChangePath: string | null;
  shellJobs: ShellJobState[];
  skillErrors: SkillScanError[];
  skillMessage: string | null;
  skills: SkillRecord[];
  totalReviewAdditions: number;
  totalReviewDeletions: number;
  usageSummary: UsageSummary;
};

export function InspectorPanel({
  activePanel,
  artifactMessage,
  artifacts,
  canUndoChangeFile,
  changeDiffPreview,
  changeReviewFileCount,
  changeReviewGroups,
  changesMessage,
  currentWorkspaceLabel,
  durableTasks,
  expandedChangeGroups,
  fileEntries,
  filePanelMessage,
  filePanelPath,
  jobMessage,
  latestSubagentEvent,
  lightweightCommitMessage,
  lightweightCommitMessageRunning,
  onCancelBackgroundShellJob,
  onClose,
  onCopyChangeDiff,
  onGoUpDirectory,
  onOpenArtifact,
  onOpenFileEntry,
  onRefreshArtifacts,
  onRefreshChanges,
  onRefreshFiles,
  onRefreshRuntimeShellJobs,
  onRefreshSkills,
  onSelectChangeFile,
  onSetExpandedChangeGroups,
  onSetFilePanelPath,
  onGenerateLightweightCommitMessage,
  onStartBackgroundShellJob,
  onToggleSkill,
  onUndoChangeFile,
  onUseChangeInPrompt,
  onUseShellCommand,
  onUseSkill,
  runtimeShellJobs,
  selectedArtifact,
  selectedChangeFile,
  selectedChangeGroup,
  selectedChangePath,
  shellJobs,
  skillErrors,
  skillMessage,
  skills,
  totalReviewAdditions,
  totalReviewDeletions,
  usageSummary
}: InspectorPanelProps) {
  const [changeDiffDialogOpen, setChangeDiffDialogOpen] = useState(false);
  const panelTitle = inspectorPanelTitle(activePanel);
  const panelSubtitle = activePanel === "Usage" ? "当前请求容量、prefix cache 和 token 用量" : currentWorkspaceLabel;
  const hasCurrentTaskPanel = Boolean(selectCurrentTask(durableTasks) || latestSubagentEvent);

  return (
    <>
    <aside className="inspector" aria-label={panelTitle}>
      <header className="inspector-drawer-header">
        <div>
          <span>工作区</span>
          <strong>{panelTitle}</strong>
        </div>
        <Button
          aria-label={`关闭${panelTitle}`}
          className="icon-button"
          shape="square"
          type="button"
          variant="text"
          onClick={onClose}
        >
          ×
        </Button>
      </header>

      <section className={`inspector-card side-resource-card change-resource-card${activePanel === "Changes" ? " changes-panel-card" : ""}`}>
        <div className="section-header">
          <div>
            <h2>{panelTitle}</h2>
            <p>{panelSubtitle}</p>
          </div>
          {activePanel === "Files" ? (
            <div className="section-actions">
              <Button icon={<ArrowLeftIcon size="14px" />} size="small" type="button" variant="outline" onClick={onGoUpDirectory}>上级</Button>
              <Button icon={<RefreshIcon size="14px" />} size="small" type="button" variant="outline" onClick={onRefreshFiles}>刷新</Button>
            </div>
          ) : null}
          {activePanel === "Changes" ? (
            <div className="section-actions">
              <Button
                disabled={lightweightCommitMessageRunning}
                icon={<AiIcon size="14px" />}
                size="small"
                type="button"
                variant="outline"
                onClick={onGenerateLightweightCommitMessage}
              >
                {lightweightCommitMessageRunning ? "生成中" : "提交信息"}
              </Button>
              <Button icon={<RefreshIcon size="14px" />} size="small" type="button" variant="outline" onClick={onRefreshChanges}>刷新</Button>
            </div>
          ) : null}
          {activePanel === "Jobs" ? (
            <div className="section-actions">
              <Button icon={<AiTerminalIcon size="14px" />} size="small" type="button" variant="outline" onClick={onStartBackgroundShellJob}>后台运行</Button>
              <Button icon={<RefreshIcon size="14px" />} size="small" type="button" variant="outline" onClick={onRefreshRuntimeShellJobs}>刷新</Button>
            </div>
          ) : null}
          {activePanel === "Skills" ? <Button icon={<RefreshIcon size="14px" />} size="small" type="button" variant="outline" onClick={onRefreshSkills}>刷新</Button> : null}
          {activePanel === "Artifacts" ? <Button icon={<RefreshIcon size="14px" />} size="small" type="button" variant="outline" onClick={onRefreshArtifacts}>刷新</Button> : null}
        </div>

        {activePanel === "Files" ? (
          <>
            <label className="workspace-input compact">
              <span>Path</span>
              <Input
                onChange={(value) => onSetFilePanelPath(String(value) || ".")}
                onKeydown={(_value, { e: event }) => {
                  if (event.key === "Enter") {
                    onRefreshFiles();
                  }
                }}
                value={filePanelPath}
              />
            </label>
            {filePanelMessage ? <p className="panel-message">{filePanelMessage}</p> : null}
            <div className="file-list">
              {fileEntries.slice(0, 8).map((entry) => (
                <button key={entry.path} type="button" onClick={() => onOpenFileEntry(entry)}>
                  <span>{entry.isDir ? "DIR" : "FILE"}</span>
                  <strong>{entry.name}</strong>
                </button>
              ))}
              {fileEntries.length === 0 ? <p className="panel-empty">暂无文件列表，点击刷新读取当前路径。</p> : null}
            </div>
          </>
        ) : null}

        {activePanel === "Changes" ? (
          <>
            <div className="change-panel-summary" aria-label="代码变更统计">
              <span><strong>{changeReviewFileCount}</strong><small>文件</small></span>
              <span><strong className="additions">+{totalReviewAdditions}</strong><small>新增</small></span>
              <span><strong className="deletions">-{totalReviewDeletions}</strong><small>删除</small></span>
            </div>
            {changesMessage ? <p className="panel-message">{changesMessage}</p> : null}
            {lightweightCommitMessage ? (
              <LightweightReviewBlock label="提交信息" review={{ ...lightweightCommitMessage, path: "commit", group: "staged" }} />
            ) : null}
            <div className="change-review-shell">
              <div className="change-groups" aria-label="变更文件">
                {changeReviewGroups.map((group) => (
                  <section className="change-group" key={group.id}>
                    <button
                      aria-expanded={expandedChangeGroups[group.id]}
                      className="change-group-header"
                      type="button"
                      onClick={() => onSetExpandedChangeGroups((current) => ({
                        ...current,
                        [group.id]: !current[group.id]
                      }))}
                    >
                      <strong>{group.label}</strong>
                      <span>{group.files.length}</span>
                    </button>
                    {expandedChangeGroups[group.id] ? (
                      <div className="change-list">
                        {group.files.map((file) => (
                          <button
                            className={file.path === selectedChangePath && file.group === selectedChangeGroup ? "active" : ""}
                            key={`${file.group}:${file.status}:${file.path}`}
                            type="button"
                            onClick={() => onSelectChangeFile(file.path, file.group)}
                          >
                            <span className={changeStatusClassName(file.status)}>{changeStatusLabel(file.status)}</span>
                            <strong title={file.path}>{fileName(file.path)}</strong>
                            <small>
                              {pathDir(file.path) || changeGroupLabel(file.group)} · +{file.additions} -{file.deletions}
                            </small>
                          </button>
                        ))}
                        {group.files.length > 8 ? (
                        <button
                          className="change-more-button"
                          type="button"
                          onClick={() => onSetExpandedChangeGroups((current) => ({
                            ...current,
                            [group.id]: !current[group.id]
                          }))}
                        >
                            <span>收起</span>
                            <strong>收起文件列表</strong>
                        </button>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                ))}
                {changeReviewGroups.length === 0 ? <p className="change-group-empty">当前没有文件变更。</p> : null}
              </div>
              <section className="change-diff-preview" aria-label="代码变更预览">
                <header>
                  <div>
                    <span>Diff 预览</span>
                    <strong>{selectedChangePath ?? "选择一个文件"}</strong>
                    {selectedChangeFile ? (
                      <small>
                        {changeGroupLabel(selectedChangeFile.group)} · {selectedChangeFile.status ?? "modified"} · +{selectedChangeFile.additions} -{selectedChangeFile.deletions}
                      </small>
                    ) : null}
                  </div>
                  {selectedChangePath ? (
                    <div className="change-preview-actions">
                      <Button
                        icon={<EditIcon size="14px" />}
                        size="small"
                        type="button"
                        variant="text"
                        onClick={() => onUseChangeInPrompt(selectedChangePath, selectedChangeGroup)}
                      >
                        加入提问
                      </Button>
                      <Button
                        icon={<CopyIcon size="14px" />}
                        size="small"
                        type="button"
                        variant="text"
                        onClick={() => onCopyChangeDiff(selectedChangePath, selectedChangeGroup)}
                      >
                        复制 diff
                      </Button>
                      <Button
                        icon={<ArrowRightUpIcon size="14px" />}
                        size="small"
                        type="button"
                        variant="text"
                        onClick={() => setChangeDiffDialogOpen(true)}
                      >
                        展开
                      </Button>
                      {selectedChangeFile ? (
                        <Button
                          disabled={!canUndoChangeFile(selectedChangeFile.path) || selectedChangeFile.group !== "turn"}
                          icon={<RollbackIcon size="14px" />}
                          size="small"
                          theme="danger"
                          type="button"
                          variant="text"
                          onClick={() => onUndoChangeFile(selectedChangeFile.path)}
                        >
                          撤销
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </header>
                <DiffView diff={selectedChangePath ? changeDiffPreview : ""} path={selectedChangePath} />
              </section>
            </div>
          </>
        ) : null}

        {activePanel === "Jobs" ? (
          <>
            {jobMessage ? <p className="panel-message">{jobMessage}</p> : null}
            <div className="job-list">
              <CurrentTaskPanel latestSubagentEvent={latestSubagentEvent} tasks={durableTasks} />
              {runtimeShellJobs.slice(0, 4).map((job) => (
                <RuntimeShellJobCard
                  job={job}
                  key={job.id}
                  onCancel={onCancelBackgroundShellJob}
                  onReuseCommand={onUseShellCommand}
                />
              ))}
              {shellJobs.slice(0, 4).map((job) => (
                <ShellJobCard
                  job={job}
                  key={job.id}
                  onReuseCommand={onUseShellCommand}
                />
              ))}
              {!hasCurrentTaskPanel && runtimeShellJobs.length === 0 && shellJobs.length === 0 ? (
                <p className="panel-empty">暂无后台任务或本轮命令记录。</p>
              ) : null}
            </div>
          </>
        ) : null}

        {activePanel === "Skills" ? (
          <>
            {skillMessage ? <p className="panel-message">{skillMessage}</p> : null}
            <SkillList
              errors={skillErrors}
              onSelectSkill={onUseSkill}
              onToggleSkill={onToggleSkill}
              skills={skills}
            />
          </>
        ) : null}

        {activePanel === "Artifacts" ? (
          <>
            {artifactMessage ? <p className="panel-message">{artifactMessage}</p> : null}
            <div className="artifact-list">
              {artifacts.slice(0, 8).map((artifact) => (
                <button
                  className={artifact.id === selectedArtifact?.id ? "active" : ""}
                  key={artifact.id}
                  onClick={() => onOpenArtifact(artifact.id)}
                  type="button"
                >
                  <span>{artifactTypeLabel(artifact.type)}</span>
                  <strong>{artifact.summary}</strong>
                  <small>{formatBytes(artifact.size)} · {formatShortDateTime(artifact.createdAt)}</small>
                  {artifact.sourceCallId ? <small>来源 {artifact.sourceCallId}</small> : null}
                </button>
              ))}
              {artifacts.length === 0 ? <p className="panel-empty">暂无产物。生成文件、diff 或报告后会出现在这里。</p> : null}
            </div>
            {selectedArtifact ? (
              <section className="artifact-preview">
                <header>
                  <Tag theme={artifactTagTheme(selectedArtifact.type)} variant="light">
                    {artifactTypeLabel(selectedArtifact.type)}
                  </Tag>
                  <strong>{selectedArtifact.summary}</strong>
                </header>
                <small>
                  {formatBytes(selectedArtifact.size)} · {formatShortDateTime(selectedArtifact.createdAt)}
                  {selectedArtifact.sourceCallId ? ` · 来源 ${selectedArtifact.sourceCallId}` : ""}
                </small>
                <pre>{selectedArtifact.content}</pre>
              </section>
            ) : null}
          </>
        ) : null}

        {activePanel === "Usage" ? (
          <ContextInspectorPanel usageSummary={usageSummary} />
        ) : null}
      </section>
    </aside>
    <Dialog
      cancelBtn={null}
      className="change-diff-review-dialog"
      confirmBtn={null}
      footer={false}
      header={(
        <div className="change-diff-dialog-title">
          <span>代码变更</span>
          <small>{changeReviewFileCount} 个文件，+{totalReviewAdditions} -{totalReviewDeletions}</small>
        </div>
      )}
      onClose={() => setChangeDiffDialogOpen(false)}
      placement="center"
      visible={changeDiffDialogOpen && activePanel === "Changes"}
      width={1120}
    >
      <section className="change-diff-review-modal" aria-label="展开 diff">
        <aside className="change-diff-review-sidebar">
          <div className="change-diff-review-stats" aria-label="变更统计">
            <span><strong>{changeReviewFileCount}</strong><small>文件</small></span>
            <span><strong className="additions">+{totalReviewAdditions}</strong><small>新增</small></span>
            <span><strong className="deletions">-{totalReviewDeletions}</strong><small>删除</small></span>
          </div>
          <div className="change-diff-review-files">
            {changeReviewGroups.map((group) => (
              <section key={`${group.id}:dialog`}>
                <header>
                  <strong>{group.label}</strong>
                  <span>{group.files.length}</span>
                </header>
                {group.files.map((file) => (
                  <button
                    className={file.path === selectedChangePath && file.group === selectedChangeGroup ? "active" : ""}
                    key={`${file.group}:${file.status}:${file.path}:dialog`}
                    type="button"
                    onClick={() => onSelectChangeFile(file.path, file.group)}
                  >
                    <span className={changeStatusClassName(file.status)}>{changeStatusLabel(file.status)}</span>
                    <strong title={file.path}>{fileName(file.path)}</strong>
                    <small>{pathDir(file.path) || changeGroupLabel(file.group)} · +{file.additions} -{file.deletions}</small>
                  </button>
                ))}
              </section>
            ))}
          </div>
        </aside>
        <main className="change-diff-review-main">
          <header>
            <div>
              <span>Diff</span>
              <strong>{selectedChangePath ?? "选择一个文件"}</strong>
              {selectedChangeFile ? (
                <small>
                  {changeGroupLabel(selectedChangeFile.group)} · {selectedChangeFile.status ?? "modified"} · +{selectedChangeFile.additions} -{selectedChangeFile.deletions}
                </small>
              ) : null}
            </div>
            {selectedChangePath ? (
              <div className="change-diff-review-actions">
                <Button icon={<EditIcon size="14px" />} size="small" type="button" variant="text" onClick={() => onUseChangeInPrompt(selectedChangePath, selectedChangeGroup)}>
                  加入提问
                </Button>
                <Button icon={<CopyIcon size="14px" />} size="small" type="button" variant="text" onClick={() => onCopyChangeDiff(selectedChangePath, selectedChangeGroup)}>
                  复制 diff
                </Button>
                {selectedChangeFile ? (
                  <Button
                    disabled={!canUndoChangeFile(selectedChangeFile.path) || selectedChangeFile.group !== "turn"}
                    icon={<RollbackIcon size="14px" />}
                    size="small"
                    theme="danger"
                    type="button"
                    variant="text"
                    onClick={() => onUndoChangeFile(selectedChangeFile.path)}
                  >
                    撤销
                  </Button>
                ) : null}
              </div>
            ) : null}
          </header>
          <div className="change-diff-review-content">
            <DiffView diff={selectedChangePath ? changeDiffPreview : ""} path={selectedChangePath} />
          </div>
        </main>
      </section>
    </Dialog>
    </>
  );
}

function inspectorPanelTitle(panel: InspectorPanelKind) {
  switch (panel) {
    case "Files":
      return "文件";
    case "Changes":
      return "代码变更";
    case "Jobs":
      return "后台任务";
    case "Skills":
      return "技能";
    case "Artifacts":
      return "产物";
    case "Usage":
      return "上下文检查器";
  }
}

function fileName(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function pathDir(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function changeStatusLabel(status: string) {
  const normalized = status.trim();
  if (normalized === "??") {
    return "新增";
  }
  if (normalized.includes("D")) {
    return "删除";
  }
  if (normalized.includes("A") || normalized.includes("W")) {
    return "新增";
  }
  if (normalized.includes("R")) {
    return "重命名";
  }
  if (normalized.includes("C")) {
    return "复制";
  }
  return "修改";
}

function changeStatusClassName(status: string) {
  const normalized = status.trim();
  if (normalized === "??" || normalized.includes("A") || normalized.includes("W")) {
    return "change-file-status added";
  }
  if (normalized.includes("D")) {
    return "change-file-status deleted";
  }
  if (normalized.includes("R") || normalized.includes("C")) {
    return "change-file-status moved";
  }
  return "change-file-status modified";
}

export function isLiveShellJob(job: ShellJobRecord) {
  return job.status === "running" || job.status === "canceling";
}

function RuntimeShellJobCard({
  job,
  onCancel,
  onReuseCommand
}: {
  job: ShellJobRecord;
  onCancel: (jobId: string) => void;
  onReuseCommand: (command: string) => void;
}) {
  const output = runtimeShellJobOutput(job);

  return (
    <article className={`job-item ${job.status}`}>
      <header>
        <span>{job.status}</span>
        <div className="job-actions">
          {isLiveShellJob(job) ? (
            <button type="button" onClick={() => onCancel(job.id)}>取消</button>
          ) : null}
          <button type="button" onClick={() => onReuseCommand(job.command)}>复用</button>
        </div>
      </header>
      <strong>{job.command || "(empty command)"}</strong>
      <dl>
        <dt>exit</dt>
        <dd>{job.exitCode ?? "n/a"}</dd>
        <dt>time</dt>
        <dd>{typeof job.durationMs === "number" ? `${job.durationMs}ms` : "n/a"}</dd>
      </dl>
      {job.timedOut ? <p className="job-warning">timeout</p> : null}
      {output ? <pre>{output}</pre> : null}
    </article>
  );
}

function ShellJobCard({ job, onReuseCommand }: { job: ShellJobState; onReuseCommand: (command: string) => void }) {
  const output = shellJobOutput(job);

  return (
    <article className={`job-item ${job.status}`}>
      <header>
        <span>{shellJobStatusText(job.status)}</span>
        <button type="button" onClick={() => onReuseCommand(job.command)}>复用</button>
      </header>
      <strong>{job.command || "(empty command)"}</strong>
      <dl>
        <dt>exit</dt>
        <dd>{job.exitCode ?? "n/a"}</dd>
        <dt>time</dt>
        <dd>{typeof job.durationMs === "number" ? `${job.durationMs}ms` : "n/a"}</dd>
      </dl>
      {job.timedOut ? <p className="job-warning">timeout</p> : null}
      {output ? <pre>{output}</pre> : null}
    </article>
  );
}

function runtimeShellJobOutput(job: ShellJobRecord) {
  const parts: string[] = [];

  if (job.stdout) {
    parts.push(`stdout${job.stdoutTruncated ? " (tail)" : ""}\n${job.stdout}`);
  }

  if (job.stderr) {
    parts.push(`stderr${job.stderrTruncated ? " (tail)" : ""}\n${job.stderr}`);
  }

  if (job.error) {
    parts.push(`error\n${job.error}`);
  }

  return parts.join("\n\n");
}

function shellJobOutput(job: ShellJobState) {
  const parts: string[] = [];

  if (job.stdoutTail) {
    parts.push(`stdout\n${job.stdoutTail}`);
  }

  if (job.stderrTail) {
    parts.push(`stderr\n${job.stderrTail}`);
  }

  if (job.errorMessage) {
    parts.push(`error\n${job.errorMessage}`);
  }

  return parts.join("\n\n");
}

function shellJobStatusText(status: ShellJobState["status"]) {
  switch (status) {
    case "requested":
      return "requested";
    case "approval":
      return "approval";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "denied":
      return "denied";
  }
}

function artifactTypeLabel(type: ArtifactMetadata["type"]) {
  switch (type) {
    case "shell-log":
      return "Shell Log";
    case "diff":
      return "Diff";
    case "test-report":
      return "Test Report";
    case "text":
      return "Text";
  }
}

function artifactTagTheme(type: ArtifactMetadata["type"]) {
  switch (type) {
    case "shell-log":
      return "primary";
    case "diff":
      return "warning";
    case "test-report":
      return "success";
    case "text":
      return "default";
  }
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} bytes`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function formatShortDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
