import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Input, Tag, Textarea } from "tdesign-react";
import { AddIcon, CloseIcon, FolderIcon, SearchIcon } from "tdesign-icons-react";
import type { ApprovalDecision, InteractionDecision, RuntimeEvent, ToolCall } from "@seekforge/protocol";
import type { CommandRiskAssessment, CommandRiskLevel } from "@seekforge/tools";
import type { SessionSummary } from "../services/sessionStore";
import { formatWorkspacePathForDisplay, normalizeWorkspacePath, workspaceProjectName } from "../services/workspacePath";

type NewSessionDialogProps = {
  onChooseWorkspace: () => void | Promise<void>;
  onClose: () => void;
  onCreate: () => void;
  onSelectRecentWorkspace: (path: string) => void | Promise<void>;
  recentWorkspacePaths: string[];
  visible: boolean;
  workspacePath: string;
};

export function NewSessionDialog({
  onChooseWorkspace,
  onClose,
  onCreate,
  onSelectRecentWorkspace,
  recentWorkspacePaths,
  visible,
  workspacePath
}: NewSessionDialogProps) {
  const hasWorkspace = Boolean(workspacePath && workspacePath !== ".");
  const recentWorkspaces = useMemo(
    () => recentWorkspacePaths.filter((path) => path && path !== "."),
    [recentWorkspacePaths]
  );
  const selectedProjectName = hasWorkspace ? workspaceProjectName(workspacePath) : null;

  return (
    <Dialog
      cancelBtn={null}
      className="new-session-dialog"
      closeOnEscKeydown
      closeOnOverlayClick
      closeBtn={false}
      confirmBtn={null}
      destroyOnClose
      footer={false}
      header={false}
      onClose={onClose}
      visible={visible}
      width={680}
    >
      <section className="new-session-modal" aria-label="新对话">
        <header className="new-session-header">
          <div className="new-session-title">
            <h2>新建对话</h2>
            <p>选择一个最近项目开始会话，或添加新的项目目录。</p>
          </div>
          <div className="new-session-header-actions">
            {recentWorkspaces.length > 0 ? (
              <Button icon={<AddIcon size="16px" />} type="button" variant="outline" onClick={onChooseWorkspace}>添加新项目</Button>
            ) : null}
            <Button aria-label="关闭新对话" icon={<CloseIcon size="18px" />} shape="circle" type="button" variant="text" onClick={onClose} />
          </div>
        </header>

        {recentWorkspaces.length > 0 ? (
          <div className="new-session-recents">
            <div className="new-session-section-title">
              <span>最近项目</span>
              <small>{selectedProjectName ? `已选择 ${selectedProjectName}` : "选择一个项目"}</small>
            </div>
            <div>
              {recentWorkspaces.map((path) => (
                <button
                  className={normalizeWorkspacePath(path) === normalizeWorkspacePath(workspacePath) ? "selected" : ""}
                  key={path}
                  title={formatWorkspacePathForDisplay(path)}
                  type="button"
                  onClick={() => void onSelectRecentWorkspace(path)}
                >
                  <span className="workspace-option-icon"><FolderIcon size="16px" /></span>
                  <span>
                    <strong>{workspaceProjectName(path)}</strong>
                    <small>{formatWorkspacePathForDisplay(path)}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="new-session-empty">
            <span className="workspace-option-icon"><FolderIcon size="18px" /></span>
            <strong>还没有最近项目</strong>
            <small>添加项目后即可在这里快速开始新对话。</small>
            <Button icon={<AddIcon size="16px" />} theme="primary" type="button" onClick={onChooseWorkspace}>添加新项目</Button>
          </div>
        )}
        <footer className="new-session-footer">
          <span>{selectedProjectName ? `将在 ${selectedProjectName} 中创建对话` : "先选择或添加项目"}</span>
          <Button type="button" variant="text" onClick={onClose}>取消</Button>
          <Button disabled={!hasWorkspace} theme="primary" type="button" onClick={onCreate}>
            创建对话
          </Button>
        </footer>
      </section>
    </Dialog>
  );
}

type SearchDialogProps = {
  currentThreadId: string;
  onClose: () => void;
  onOpenSession: (summary: SessionSummary) => void;
  onQueryChange: (query: string) => void;
  query: string;
  results: SessionSummary[];
  visible: boolean;
};

export function SearchDialog({
  currentThreadId,
  onClose,
  onOpenSession,
  onQueryChange,
  query,
  results,
  visible
}: SearchDialogProps) {
  const displayResults = useMemo(() => results.slice(0, 9), [results]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    setHoveredIndex(null);
  }, [query, visible]);

  return (
    <Dialog
      closeOnEscKeydown
      closeOnOverlayClick
      destroyOnClose
      footer={false}
      header={false}
      onClose={onClose}
      visible={visible}
      width={680}
    >
      <section className="search-modal" aria-label="搜索对话">
        <Input
          autofocus
          aria-label="搜索对话"
          clearable
          prefixIcon={<SearchIcon size="18px" />}
          onChange={(value) => onQueryChange(String(value))}
          placeholder="搜索对话"
          value={query}
        />
        <div className="search-section-label">对话</div>
        <div className="search-result-list">
          {displayResults.length > 0 ? (
            displayResults.map((summary, index) => (
              <button
                aria-current={index === hoveredIndex ? "true" : undefined}
                className={[
                  summary.threadId === currentThreadId ? "current" : "",
                  index === hoveredIndex ? "active" : ""
                ].filter(Boolean).join(" ")}
                key={summary.threadId}
                onClick={() => onOpenSession(summary)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex((current) => (current === index ? null : current))}
                type="button"
              >
                <span>{summary.title}</span>
                <small title={summary.workspacePath ? formatWorkspacePathForDisplay(summary.workspacePath) : "默认工作台"}>
                  {summary.workspacePath ? workspaceProjectName(summary.workspacePath) : "默认工作台"}
                </small>
              </button>
            ))
          ) : (
            <p>没有匹配的对话</p>
          )}
        </div>
      </section>
    </Dialog>
  );
}

type ApprovalDialogProps = {
  formatPayload: (value: unknown) => string;
  onDecide: (decision: ApprovalDecision["decision"], editedInput?: unknown, rememberForSession?: boolean) => void;
  pendingApproval: ToolCall | null;
  risk: CommandRiskAssessment | null;
  riskLevelText: (level: CommandRiskLevel) => string;
  riskTagTheme: (level: CommandRiskLevel) => "default" | "primary" | "warning" | "danger" | "success";
};

type InteractionRequestEvent = Extract<RuntimeEvent, { type: "interaction_requested" }>;

type InteractionDialogProps = {
  onDecide: (decision: InteractionDecision) => void;
  request: InteractionRequestEvent | null;
};

export const CUSTOM_INTERACTION_OPTION_LABEL = "以上都不满足，我补充信息";

export function buildInteractionDecision(input: {
  customMode: boolean;
  customText: string;
  request: InteractionRequestEvent;
  selectedOptionId: string | null;
}): { decision?: InteractionDecision; error?: string } {
  if (input.customMode) {
    const trimmed = input.customText.trim();
    return trimmed
      ? { decision: { type: "custom", customText: trimmed } }
      : { error: "请补充信息后再继续。" };
  }

  const option = input.request.options.find((item) => item.id === input.selectedOptionId);
  return option
    ? { decision: { type: "option", optionId: option.id, value: option.value } }
    : { error: "请选择一个选项，或补充自己的信息。" };
}

export function InteractionDialog({ onDecide, request }: InteractionDialogProps) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedOptionId(request?.recommendedOptionId ?? request?.options[0]?.id ?? null);
    setCustomMode(false);
    setCustomText("");
    setError(null);
  }, [request]);

  function submit() {
    if (!request) {
      return;
    }

    const result = buildInteractionDecision({ customMode, customText, request, selectedOptionId });
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.decision) {
      onDecide(result.decision);
    }
  }

  return (
    <Dialog
      cancelBtn={null}
      closeBtn={false}
      closeOnOverlayClick={false}
      confirmBtn={null}
      footer={(
        <div className="interaction-footer">
          <span>选择后会自动继续计划</span>
          <Button className="interaction-continue-button" type="button" onClick={submit}>继续</Button>
        </div>
      )}
      header={request?.title ?? "需要确认"}
      visible={Boolean(request)}
      width={640}
    >
      {request ? (
        <section className="interaction-modal" aria-label="交互式确认">
          <p>{request.message}</p>
          <div className="interaction-options" role="radiogroup" aria-label="候选项">
            {request.options.map((option) => (
              <button
                className={!customMode && selectedOptionId === option.id ? "active" : ""}
                key={option.id}
                type="button"
                onClick={() => {
                  setCustomMode(false);
                  setSelectedOptionId(option.id);
                  setError(null);
                }}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.id === request.recommendedOptionId ? <em>推荐</em> : null}
                </span>
                {option.description ? <small>{option.description}</small> : null}
                {option.value ? <code>{option.value}</code> : null}
              </button>
            ))}
            <button
              className={customMode ? "active" : ""}
              type="button"
              onClick={() => {
                setCustomMode(true);
                setError(null);
              }}
            >
              <span><strong>{CUSTOM_INTERACTION_OPTION_LABEL}</strong></span>
              <small>选择这个选项后输入你的实际要求或缺失信息。</small>
            </button>
          </div>
          {customMode ? (
            <label className="interaction-custom">
              <span>补充信息</span>
              <Textarea
                autosize={{ minRows: 4, maxRows: 8 }}
                placeholder="输入你想补充的信息..."
                value={customText}
                onChange={(value) => {
                  setCustomText(String(value));
                  setError(null);
                }}
              />
            </label>
          ) : null}
          {error ? <p className="interaction-error">{error}</p> : null}
        </section>
      ) : null}
    </Dialog>
  );
}

export function ApprovalDialog({
  formatPayload,
  onDecide,
  pendingApproval,
  risk,
  riskLevelText,
  riskTagTheme
}: ApprovalDialogProps) {
  const originalPayload = useMemo(
    () => pendingApproval ? formatPayload(pendingApproval.input) : "{}",
    [formatPayload, pendingApproval]
  );
  const [draftPayload, setDraftPayload] = useState(originalPayload);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [showPayloadEditor, setShowPayloadEditor] = useState(false);
  const payloadEdited = draftPayload.trim() !== originalPayload.trim();
  const inputSummary = useMemo(() => summarizeApprovalInput(pendingApproval), [pendingApproval]);

  useEffect(() => {
    setDraftPayload(originalPayload);
    setPayloadError(null);
    setShowPayloadEditor(false);
  }, [originalPayload]);

  useEffect(() => {
    if (!pendingApproval) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDecide("denied");
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (payloadEdited) {
          approveEditedPayload();
        } else {
          onDecide("approved-once");
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onDecide, payloadEdited, pendingApproval, draftPayload]);

  function approveEditedPayload() {
    try {
      onDecide("edited", JSON.parse(draftPayload));
    } catch (error) {
      setPayloadError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Dialog
      cancelBtn={null}
      closeBtn={false}
      closeOnOverlayClick={false}
      confirmBtn={null}
      footer={(
        <div className="approval-footer">
          <span>Esc 拒绝 · ⌘Enter 批准</span>
          <div>
	            <Button type="button" variant="outline" onClick={() => onDecide("denied")}>拒绝</Button>
	            <Button disabled={!payloadEdited} type="button" variant="outline" onClick={approveEditedPayload}>按修改批准</Button>
	            <Button disabled={payloadEdited} type="button" variant="outline" onClick={() => onDecide("approved-once", undefined, true)}>本会话记住</Button>
	            <Button theme="primary" type="button" onClick={() => onDecide("approved-once")}>批准一次</Button>
          </div>
        </div>
      )}
      header={pendingApproval ? (
        <div className="approval-title">
          <span>需要审批</span>
          <Tag theme="default" variant="light">{pendingApproval.name}</Tag>
          {risk ? <Tag theme={riskTagTheme(risk.level)} variant="light">{riskLevelText(risk.level)}</Tag> : null}
        </div>
      ) : "工具审批"}
      visible={Boolean(pendingApproval)}
      width={640}
    >
      {pendingApproval ? (
        <section className="approval-modal" aria-label="工具审批">
          <div className="approval-hero">
            <span>{pendingApproval.name}</span>
            <strong>{inputSummary.primary}</strong>
            {inputSummary.secondary ? <small>{inputSummary.secondary}</small> : null}
          </div>
          <div className="approval-facts" aria-label="工具输入摘要">
            {inputSummary.rows.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>
                <code>{row.value}</code>
              </div>
            ))}
          </div>
          {risk ? (
            <section className={`approval-risk risk-${risk.level}`}>
              <div>
                <Tag theme={riskTagTheme(risk.level)} variant="light">{riskLevelText(risk.level)}</Tag>
                <span>{risk.summary}</span>
              </div>
              <ul>
                {risk.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <button
            className={showPayloadEditor || payloadEdited ? "approval-json-toggle active" : "approval-json-toggle"}
            type="button"
            onClick={() => setShowPayloadEditor((visible) => !visible)}
          >
            <span>{showPayloadEditor || payloadEdited ? "隐藏工具输入 JSON" : "查看或编辑工具输入 JSON"}</span>
            {payloadEdited ? <small>已修改</small> : <small>高级</small>}
          </button>
          {showPayloadEditor || payloadEdited ? (
            <label className="approval-editor">
              <Textarea
                autosize={{ minRows: 8, maxRows: 14 }}
                value={draftPayload}
                onChange={(value) => {
                  setDraftPayload(String(value));
                  setPayloadError(null);
                }}
              />
            </label>
          ) : null}
          {payloadError ? <p className="approval-editor-error">JSON 格式无效：{payloadError}</p> : null}
        </section>
      ) : null}
    </Dialog>
  );
}

function summarizeApprovalInput(call: ToolCall | null) {
  if (!call) {
    return { primary: "等待工具请求", secondary: "", rows: [] as Array<{ label: string; value: string }> };
  }

  const input = isRecord(call.input) ? call.input : {};
  const command = stringValue(input.command);
  const path = stringValue(input.path) || stringValue(input.file) || stringValue(input.cwd);
  const url = stringValue(input.url);
  const primary = command || path || url || `${call.name} 请求`;
  const secondary = command
    ? stringValue(input.cwd) || "Shell 命令将在当前工作区执行"
    : path
      ? "文件或工作区操作"
      : url
        ? "网络请求"
        : "请确认工具输入后继续";
  const rows = [
    { label: "工具", value: call.name },
    command ? { label: "命令", value: command } : null,
    path ? { label: "路径", value: path } : null,
    url ? { label: "URL", value: url } : null,
    stringValue(input.cwd) && !command ? { label: "目录", value: stringValue(input.cwd) } : null
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return { primary, secondary, rows: rows.slice(0, 5) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
