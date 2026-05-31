import { useState } from "react";
import { Button, Dialog, Input, Tag } from "tdesign-react";
import { ArrowRightUpIcon, ChevronDownIcon, CopyIcon, EditIcon, FileIcon, RollbackIcon, SearchIcon } from "tdesign-icons-react";
import { changeGroupLabel, type ChangeReviewItem } from "../features/changes/changeGroups";
import type { ChangeFileStat } from "../features/changes/changeSummary";
import type { LightweightReviewResult } from "../services/lightweightCompletion";
import { highlightCode, languageForPath } from "./codeHighlight";

type ChangeSummaryCardProps = {
  canUndoFile: (path: string) => boolean;
  diffPreview: string;
  files: Array<ChangeFileStat | ChangeReviewItem>;
  onCopyDiff: (path: string, group?: ChangeReviewItem["group"]) => void;
  onOpenFile: (path: string, group?: ChangeReviewItem["group"]) => void;
  onReview: () => void;
  onUndo: () => void;
  onUndoFile: (path: string) => void;
  onUseInPrompt: (path: string) => void;
  selectedGroup: ChangeReviewItem["group"];
  selectedPath: string | null;
  totalAdditions: number;
  totalDeletions: number;
};

export function ChangeSummaryCard({
  canUndoFile,
  diffPreview,
  files,
  onCopyDiff,
  onOpenFile,
  onReview,
  onUndo,
  onUndoFile,
  onUseInPrompt,
  selectedGroup,
  selectedPath,
  totalAdditions,
  totalDeletions
}: ChangeSummaryCardProps) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewQuery, setReviewQuery] = useState("");

  if (files.length === 0) {
    return null;
  }

  const content = (
    <ChangeSummaryContent
      diffPreview={diffPreview}
      files={files}
      onOpenFile={onOpenFile}
      selectedGroup={selectedGroup}
      selectedPath={selectedPath}
    />
  );
  const selectedFile = files.find((file) => file.path === selectedPath && groupOf(file) === selectedGroup) ?? null;
  const primaryFile = selectedFile ?? files[0];
  const reviewStats = summarizeReviewFiles(files);
  const reviewFiles = filterReviewFiles(files, reviewQuery);
  function openReviewDialog() {
    if (!selectedPath && files[0]) {
      onOpenFile(files[0].path, groupOf(files[0]));
    }
    onReview();
    setReviewOpen(true);
  }

  return (
    <>
      <article className="change-summary-card">
        <header className="change-summary-header">
          <div className="change-summary-glyph" aria-hidden="true">
            <FileIcon size="24px" />
          </div>
          <div className="change-summary-title">
            <strong>{changeVerb(primaryFile)} {fileDisplayName(primaryFile.path)}</strong>
            <span className="change-totals">
              <span className="additions">+{totalAdditions}</span>
              <span className="deletions">-{totalDeletions}</span>
            </span>
          </div>
          <div className="change-summary-actions">
            {selectedPath ? (
              <Button icon={<EditIcon size="15px" />} type="button" variant="text" onClick={() => onUseInPrompt(selectedPath)}>
                加入提问
              </Button>
            ) : null}
            <Button icon={<RollbackIcon size="15px" />} type="button" variant="text" onClick={onUndo}>撤销</Button>
            <Button
              className="change-review-primary"
              icon={<ArrowRightUpIcon size="15px" />}
              type="button"
              variant="text"
              onClick={openReviewDialog}
            >
              审核
            </Button>
          </div>
        </header>
        {content}
      </article>
      <Dialog
        cancelBtn={null}
        confirmBtn={null}
        footer={false}
        header={(
          <div className="change-review-title">
            <span>审核文件更改</span>
            <small>{files.length} 个文件，+{totalAdditions} -{totalDeletions}</small>
          </div>
        )}
        onClose={() => setReviewOpen(false)}
        visible={reviewOpen}
        width={1080}
      >
        <section className="change-review-overlay">
          <aside>
            <div className="change-review-sidebar-header">
              <Input
                clearable
                prefixIcon={<SearchIcon size="14px" />}
                placeholder="搜索文件"
                size="small"
                value={reviewQuery}
                onChange={(value) => setReviewQuery(String(value))}
              />
              <div className="change-review-stats" aria-label="变更统计">
                <span><strong>{files.length}</strong><small>文件</small></span>
                <span><strong className="additions">+{totalAdditions}</strong><small>新增</small></span>
                <span><strong className="deletions">-{totalDeletions}</strong><small>删除</small></span>
              </div>
            </div>
            <div className="change-review-group-strip" aria-label="变更来源">
              {reviewStats.groups.map((item) => (
                <span key={item.label}>{item.label} <strong>{item.count}</strong></span>
              ))}
            </div>
            <div className="change-review-file-list">
              {reviewFiles.map((file) => (
                <button
                  className={file.path === selectedPath && groupOf(file) === selectedGroup ? "active" : ""}
                  key={`${groupOf(file)}:${file.status}:${file.path}:review`}
                  type="button"
                  onClick={() => onOpenFile(file.path, groupOf(file))}
                >
                  <span>
                    <strong>{fileDisplayName(file.path)}</strong>
                    <em>{pathDirectory(file.path)}</em>
                  </span>
                  <small>
                    {"group" in file ? <Tag size="small" theme="default" variant="light">{changeGroupLabel(file.group)}</Tag> : null}
                    {file.status ? <Tag className={statusClassName(file.status)} size="small" theme="primary" variant="light">{statusLabel(file.status)}</Tag> : null}
                    <span className="additions">+{file.additions}</span>
                    <span className="deletions">-{file.deletions}</span>
                  </small>
                </button>
              ))}
              {reviewFiles.length === 0 ? (
                <p className="change-review-empty">没有匹配的文件。</p>
              ) : null}
            </div>
          </aside>
          <main>
            <header>
              <div className="change-review-file-title">
                <strong>{selectedPath ?? "选择文件"}</strong>
                {selectedFile ? (
                  <small>
                    {changeGroupLabel(groupOf(selectedFile))} · +{selectedFile.additions} -{selectedFile.deletions}
                  </small>
                ) : null}
              </div>
              {selectedPath ? (
                <div className="change-review-actions">
                  <Button
                    icon={<EditIcon size="14px" />}
                    size="small"
                    type="button"
                    variant="text"
                    onClick={() => onUseInPrompt(selectedPath)}
                  >
                    加入提问
                  </Button>
                  <Button
                    icon={<CopyIcon size="14px" />}
                    size="small"
                    type="button"
                    variant="text"
                    onClick={() => onCopyDiff(selectedPath, selectedGroup)}
                  >
                    复制 diff
                  </Button>
                  <Button
                    icon={<CopyIcon size="14px" />}
                    size="small"
                    type="button"
                    variant="text"
                    onClick={() => void navigator.clipboard.writeText(selectedPath)}
                  >
                    复制路径
                  </Button>
                  {selectedFile ? (
                    <Button
                      disabled={!canUndoFile(selectedFile.path) || groupOf(selectedFile) !== "turn"}
                      icon={<RollbackIcon size="14px" />}
                      size="small"
                      theme="danger"
                      type="button"
                      variant="text"
                      onClick={() => onUndoFile(selectedFile.path)}
                    >
                      撤销单文件
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </header>
            <DiffView diff={selectedPath ? diffPreview : ""} path={selectedPath} />
          </main>
        </section>
      </Dialog>
    </>
  );
}

export function LightweightReviewBlock({
  label = "轻量编辑",
  review
}: {
  label?: string;
  review: LightweightReviewResult & { group: ChangeReviewItem["group"]; path: string };
}) {
  return (
    <section className="lightweight-review-result" aria-label="轻量评审结果">
      <header>
        <span>{label}</span>
        <Tag size="small" theme={review.mode === "fim" ? "success" : "warning"} variant="light">
          {review.mode === "fim" ? "FIM" : "fallback"}
        </Tag>
      </header>
      <p>{review.text}</p>
    </section>
  );
}

function ChangeSummaryContent({
  diffPreview,
  files,
  onOpenFile,
  selectedGroup,
  selectedPath
}: Pick<ChangeSummaryCardProps, "diffPreview" | "files" | "onOpenFile" | "selectedGroup" | "selectedPath">) {
  const [expanded, setExpanded] = useState(true);
  const activeFile = files.find((file) => file.path === selectedPath && groupOf(file) === selectedGroup) ?? files[0];
  const activeGroup = groupOf(activeFile);
  const hasSelectedDiff = activeFile.path === selectedPath && activeGroup === selectedGroup;
  const activeDirectory = pathDirectory(activeFile.path);

  return (
    <section className={expanded ? "change-summary-detail open" : "change-summary-detail"}>
      <button className="change-detail-toggle" type="button" onClick={() => setExpanded((value) => !value)}>
        <span>
          <strong>{fileDisplayName(activeFile.path)}</strong>
          <small>{activeDirectory || changeGroupLabel(activeGroup)}</small>
        </span>
        <span className="change-detail-meta">
          <em className={statusClassName(activeFile.status)}>{statusLabel(activeFile.status)}</em>
          <small><span className="additions">+{activeFile.additions}</span> <span className="deletions">-{activeFile.deletions}</span></small>
        </span>
        <ChevronDownIcon className="change-file-chevron" size="18px" />
      </button>
      {expanded ? (
        <>
          {files.length > 1 ? (
            <div className="change-file-strip" aria-label="变更文件">
              {files.map((file) => {
                const group = groupOf(file);
                const active = file.path === activeFile.path && group === activeGroup;
                return (
                  <button
                    className={active ? "active" : ""}
                    key={`${group}:${file.status}:${file.path}`}
                    type="button"
                    onClick={() => onOpenFile(file.path, group)}
                  >
                    <span>{fileDisplayName(file.path)}</span>
                    <small>
                      <em className={statusClassName(file.status)}>{statusLabel(file.status)}</em>
                      <span className="additions">+{file.additions}</span>
                      <span className="deletions">-{file.deletions}</span>
                    </small>
                  </button>
                );
              })}
            </div>
          ) : null}
          <section className="change-detail">
            {hasSelectedDiff ? <DiffView diff={diffPreview} path={activeFile.path} /> : (
              <button className="change-detail-empty" type="button" onClick={() => onOpenFile(activeFile.path, activeGroup)}>
                选择该文件后显示真实 diff。
              </button>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}

function filterReviewFiles(files: Array<ChangeFileStat | ChangeReviewItem>, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return files;
  }

  return files.filter((file) => {
    const group = groupOf(file);
    const haystack = [
      file.path,
      file.status,
      group,
      changeGroupLabel(group)
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function summarizeReviewFiles(files: Array<ChangeFileStat | ChangeReviewItem>) {
  const groups = new Map<string, number>();
  for (const file of files) {
    const label = changeGroupLabel(groupOf(file));
    groups.set(label, (groups.get(label) ?? 0) + 1);
  }

  return {
    groups: [...groups.entries()].map(([label, count]) => ({ label, count }))
  };
}

function groupOf(file: ChangeFileStat | ChangeReviewItem): ChangeReviewItem["group"] {
  return "group" in file ? file.group : "turn";
}

export function DiffView({ diff, path }: { diff: string; path?: string | null }) {
  if (!diff.trim()) {
    return <pre className="diff-view empty">没有可显示的 diff。</pre>;
  }

  const rows = buildDiffRows(diff);
  const language = languageForPath(path) ?? languageForPath(pathFromDiff(diff));

  return (
    <pre className="diff-view">
      {rows.map((row, index) => {
        if (row.kind === "fold") {
          return (
            <span className="diff-line fold" key={`${index}:fold:${row.text}`}>
              <span className="diff-line-number old">⌄</span>
              <span className="diff-line-number new" />
              <span className="diff-line-text">{row.text}</span>
            </span>
          );
        }

        return (
          <span className={`diff-line ${row.kind}`} key={`${index}:${row.text}`}>
            <span className="diff-line-number old">{row.oldNumber}</span>
            <span className="diff-line-number new">{row.newNumber}</span>
            <DiffLineText row={row} language={language} />
          </span>
        );
      })}
    </pre>
  );
}

function DiffLineText({ language, row }: { language: string | null; row: DiffRow }) {
  if (row.kind === "meta" || row.kind === "hunk") {
    return <span className="diff-line-text">{row.text || " "}</span>;
  }

  const prefix = diffCodePrefix(row);
  const body = prefix ? row.text.slice(1) : row.text;
  const tokens = highlightCode(body || " ", language);

  return (
    <span className="diff-line-text">
      {prefix ? <span className="diff-line-prefix">{prefix}</span> : null}
      {tokens.map((token, index) => (
        <span className={token.kind === "plain" ? undefined : `code-token ${token.kind}`} key={`${index}:${token.kind}:${token.text}`}>
          {token.text}
        </span>
      ))}
    </span>
  );
}

function diffCodePrefix(row: DiffRow) {
  if (row.kind === "add" || row.kind === "delete") {
    return row.text[0] ?? "";
  }
  if (row.kind === "context" && row.text.startsWith(" ")) {
    return " ";
  }
  return "";
}

type DiffRow = {
  kind: DiffLineKind | "fold";
  newNumber: number | string;
  oldNumber: number | string;
  text: string;
};

type DiffLineKind = "meta" | "hunk" | "add" | "delete" | "context";

function buildDiffRows(diff: string): DiffRow[] {
  let oldLine = 0;
  let newLine = 0;
  const sourceRows = diff.split("\n").map((line) => {
    const kind = diffLineKind(line);
    const row: DiffRow = { kind, oldNumber: "", newNumber: "", text: line };

    if (kind === "hunk") {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = match ? Number(match[1]) : oldLine;
      newLine = match ? Number(match[2]) : newLine;
      return row;
    }

    if (kind === "delete") {
      row.oldNumber = oldLine || "";
      oldLine += 1;
      return row;
    }

    if (kind === "add") {
      row.newNumber = newLine || "";
      newLine += 1;
      return row;
    }

    if (kind === "context" && oldLine && newLine) {
      row.oldNumber = oldLine;
      row.newNumber = newLine;
      oldLine += 1;
      newLine += 1;
    }

    return row;
  });
  const rows: DiffRow[] = [];
  let index = 0;

  while (index < sourceRows.length) {
    if (sourceRows[index].kind !== "context") {
      rows.push(sourceRows[index]);
      index += 1;
      continue;
    }

    let end = index;
    while (end < sourceRows.length && sourceRows[end].kind === "context") {
      end += 1;
    }

    const count = end - index;
    if (count > 10) {
      rows.push(...sourceRows.slice(index, index + 3));
      rows.push({ kind: "fold", oldNumber: "", newNumber: "", text: `${count - 6} 行未修改` });
      rows.push(...sourceRows.slice(end - 3, end));
    } else {
      rows.push(...sourceRows.slice(index, end));
    }

    index = end;
  }

  return rows;
}

function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "meta";
  }

  if (line.startsWith("@@")) {
    return "hunk";
  }

  if (line.startsWith("+")) {
    return "add";
  }

  if (line.startsWith("-")) {
    return "delete";
  }

  return "context";
}

function pathFromDiff(diff: string) {
  const plusLine = diff.split("\n").find((line) => line.startsWith("+++ "));
  const path = plusLine?.replace(/^\+\+\+\s+/, "").trim();
  if (!path || path === "/dev/null") {
    return null;
  }
  return path.replace(/^[ab]\//, "");
}

function fileDisplayName(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function pathDirectory(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "";
  }
  return parts.slice(0, -1).join("/");
}

function statusLabel(status: string) {
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

function statusClassName(status: string) {
  const normalized = status.trim();
  if (normalized === "??" || normalized.includes("A") || normalized.includes("W")) {
    return "change-status-pill added";
  }
  if (normalized.includes("D")) {
    return "change-status-pill deleted";
  }
  if (normalized.includes("R") || normalized.includes("C")) {
    return "change-status-pill moved";
  }
  return "change-status-pill modified";
}

function changeVerb(file: ChangeFileStat | ChangeReviewItem) {
  if (file.status.includes("D")) {
    return "已删除";
  }

  if (file.status.includes("A") || file.status === "??") {
    return "已新增";
  }

  return "已编辑";
}
