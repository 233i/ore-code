import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Dialog, Dropdown, Empty, Input, Select, Switch, Tag, Textarea } from "tdesign-react";
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  ComponentGridIcon,
  MoreIcon,
  SearchIcon,
  SettingIcon
} from "tdesign-icons-react";
import { validateSkillContent, type SkillRecord, type SkillScanError } from "../services/skillRegistry";
import { validateSkillDraft, type SkillDraft, type SkillTemplate } from "../services/skillStore";
import type { McpAddServerInput, McpCallOutput, McpPromptGetOutput, McpResourceReadOutput, McpServerSnapshot, McpToolSnapshot } from "../services/mcpHost";

type SkillFilter = "all" | "enabled" | "disabled";
type McpStatusFilter = "all" | McpServerSnapshot["status"];
type McpPreset = {
  description: string;
  input: McpAddServerInput;
  name: string;
};
type McpServerDraft = {
  args: string;
  command: string;
  connectTimeout: string;
  disabledTools: string;
  enabled: boolean;
  enabledTools: string;
  env: string;
  executeTimeout: string;
  framing: "header" | "jsonl";
  name: string;
  transport: "stdio" | "http";
  url: string;
};

const mcpPresets: McpPreset[] = [
  {
    name: "TDesign",
    description: "组件文档、DOM、变更日志",
    input: {
      args: ["-y", "tdesign-mcp-server@latest"],
      command: "npx",
      executeTimeout: 20,
      framing: "jsonl",
      name: "tdesign-mcp-server"
    }
  },
  {
    name: "Playwright",
    description: "浏览器自动化与页面检查",
    input: {
      args: ["-y", "@playwright/mcp@latest"],
      command: "npx",
      executeTimeout: 20,
      name: "playwright"
    }
  },
  {
    name: "GitHub",
    description: "PR、issue、CI 工作流",
    input: {
      args: ["-y", "@modelcontextprotocol/server-github"],
      command: "npx",
      executeTimeout: 20,
      name: "github"
    }
  },
  {
    name: "Figma",
    description: "设计上下文与资源引用",
    input: {
      args: ["-y", "figma-developer-mcp", "--stdio"],
      command: "npx",
      executeTimeout: 20,
      name: "figma"
    }
  }
];

type SkillsWorkspaceProps = {
  errors: SkillScanError[];
  message: string | null;
  mcpBusyLabel: string | null;
  mcpMessage: string | null;
  mcpSnapshot: McpToolSnapshot | null;
  onAddMcpServer: (input: McpAddServerInput) => void;
  onCallMcpTool: (input: { arguments: Record<string, unknown>; qualifiedName: string }) => Promise<McpCallOutput | null>;
  onClose: () => void;
  onCreateSkill: (draft: SkillDraft) => Promise<void>;
  onInitMcp: () => void;
  onManageSkills: () => void;
  onOpenSkillFolder: (skill: SkillRecord) => Promise<void>;
  onRefresh: () => void;
  onRefreshMcp: () => void;
  onReadMcpResource: (resource: { serverName: string; uri: string }) => Promise<McpResourceReadOutput | null>;
  onRenameSkill: (skill: SkillRecord, nextId: string) => Promise<void>;
  onRemoveMcpServer: (name: string) => void;
  onSelectSkill: (skill: SkillRecord) => void;
  onStopMcp: () => void;
  onTrashSkill: (skill: SkillRecord) => Promise<void>;
  onUpdateSkill: (skill: SkillRecord, content: string) => Promise<void>;
  onUseMcpPrompt: (prompt: { arguments?: Record<string, unknown>; name: string; serverName: string }) => Promise<McpPromptGetOutput | null>;
  onToggleMcpServer: (name: string, enabled: boolean) => void;
  onToggleSkill: (skillId: string, enabled: boolean) => void;
  onUpdateMcpServer: (input: McpAddServerInput) => void;
  onValidateMcp: () => void;
  skillRootLabel: string;
  skills: SkillRecord[];
  visible: boolean;
};

const filterOptions: Array<{ label: string; value: SkillFilter }> = [
  { label: "全部", value: "all" },
  { label: "已启用", value: "enabled" },
  { label: "已停用", value: "disabled" }
];

const mcpStatusFilters: Array<{ label: string; value: McpStatusFilter }> = [
  { label: "全部", value: "all" },
  { label: "已连接", value: "connected" },
  { label: "连接中", value: "connecting" },
  { label: "失败", value: "failed" },
  { label: "停用", value: "disabled" }
];

function filterLabel(value: SkillFilter) {
  return filterOptions.find((option) => option.value === value)?.label ?? "全部";
}

export function SkillsWorkspace({
  errors,
  message,
  mcpBusyLabel,
  mcpMessage,
  mcpSnapshot,
  onAddMcpServer,
  onCallMcpTool,
  onClose,
  onCreateSkill,
  onInitMcp,
  onManageSkills,
  onOpenSkillFolder,
  onRefresh,
  onRefreshMcp,
  onReadMcpResource,
  onRenameSkill,
  onRemoveMcpServer,
  onSelectSkill,
  onStopMcp,
  onTrashSkill,
  onUpdateMcpServer,
  onUpdateSkill,
  onUseMcpPrompt,
  onToggleMcpServer,
  onToggleSkill,
  onValidateMcp,
  skillRootLabel,
  skills,
  visible
}: SkillsWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"skills" | "sources">("skills");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createDraft, setCreateDraft] = useState<SkillDraft>({
    body: "",
    description: "",
    id: "",
    name: "",
    template: "general"
  });
  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedSkillId) ?? null,
    [selectedSkillId, skills]
  );
  const filteredSkills = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    return skills.filter((skill) => {
      if (filter === "enabled" && !skill.enabled) {
        return false;
      }
      if (filter === "disabled" && skill.enabled) {
        return false;
      }
      if (!keyword) {
        return true;
      }

      return [
        skill.name,
        skill.id,
        skill.description,
        skill.skillPath
      ].join(" ").toLowerCase().includes(keyword);
    });
  }, [filter, query, skills]);

  useEffect(() => {
    if (!selectedSkill) {
      setSelectedSkillId(null);
    }
  }, [selectedSkill]);

  const createIssues = useMemo(
    () => validateSkillDraft(createDraft, skills.map((skill) => skill.id)),
    [createDraft, skills]
  );
  const hasCreateErrors = createIssues.some((issue) => issue.severity === "error");

  const openCreateSkillDialog = () => {
    setActiveTab("skills");
    setShowCreateDialog(true);
  };

  const submitCreateSkill = async () => {
    if (hasCreateErrors) {
      return;
    }
    await onCreateSkill(createDraft);
    setShowCreateDialog(false);
    setCreateDraft({
      body: "",
      description: "",
      id: "",
      name: "",
      template: "general"
    });
  };

  if (!visible) {
    return null;
  }

  return (
    <section className="skills-library-shell" aria-label="MCP 与技能">
      <div className="skills-library-header">
        <div className="skills-library-switch" aria-label="MCP 与技能">
          <button className={activeTab === "sources" ? "active" : ""} type="button" onClick={() => setActiveTab("sources")}>
            MCP
          </button>
          <button className={activeTab === "skills" ? "active" : ""} type="button" onClick={() => setActiveTab("skills")}>
            技能
          </button>
        </div>

        <div className="skills-library-actions">
          {activeTab === "sources" ? (
            null
          ) : (
            <>
              <Button className="skills-manage-directory-button" icon={<SettingIcon size="16px" />} shape="round" type="button" onClick={onManageSkills}>
                管理目录
              </Button>
              <Dropdown
                options={[
                  { content: "新建技能", value: "create" },
                  { content: "从 SKILL.md 模板创建", value: "template" }
                ]}
                trigger="click"
                onClick={openCreateSkillDialog}
              >
                <Button shape="round" suffix={<ChevronDownIcon size="15px" />} type="button" variant="outline">
                  创建
                </Button>
              </Dropdown>
            </>
          )}
          <Dropdown
            options={activeTab === "sources"
              ? [
                { content: "初始化 MCP 配置", value: "init-mcp" },
                { content: "刷新 MCP", value: "refresh-mcp" },
                { content: "校验 MCP 配置", value: "validate-mcp" },
                { content: "停止全部 MCP", value: "stop-mcp" },
                { content: "关闭 MCP 页", value: "close" }
              ]
              : [
                { content: "刷新技能", value: "refresh" },
                { content: "关闭技能页", value: "close" }
              ]}
            trigger="click"
            onClick={(option) => {
              if (option.value === "init-mcp") {
                onInitMcp();
              }
              if (option.value === "refresh-mcp") {
                onRefreshMcp();
              }
              if (option.value === "validate-mcp") {
                onValidateMcp();
              }
              if (option.value === "stop-mcp") {
                onStopMcp();
              }
              if (option.value === "refresh") {
                onRefresh();
              }
              if (option.value === "close") {
                onClose();
              }
            }}
          >
            <Button aria-label={activeTab === "sources" ? "更多 MCP 操作" : "更多技能操作"} icon={<MoreIcon size="20px" />} shape="circle" type="button" variant="text" />
          </Dropdown>
        </div>
      </div>

      <div className="skills-library-body">
        {activeTab === "skills" ? (
          <div className="skills-catalog-view">
            <div className="skills-library-toolbar">
              <Input
                className="skills-search-input"
                clearable
                onChange={(value) => setQuery(String(value))}
                placeholder="搜索技能"
                prefixIcon={<SearchIcon size="18px" />}
                size="large"
                type="search"
                value={query}
              />
              <div
                className="skills-filter-menu"
                onBlur={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                    setFilterMenuOpen(false);
                  }
                }}
              >
                <button
                  aria-expanded={filterMenuOpen}
                  aria-haspopup="listbox"
                  className="skills-filter-trigger"
                  type="button"
                  onClick={() => setFilterMenuOpen((current) => !current)}
                >
                  <span>{filterLabel(filter)}</span>
                  <ChevronDownIcon size="15px" />
                </button>
                {filterMenuOpen ? (
                  <div className="skills-filter-options" role="listbox">
                    {filterOptions.map((option) => (
                      <button
                        aria-selected={option.value === filter}
                        className={option.value === filter ? "active" : ""}
                        key={option.value}
                        role="option"
                        type="button"
                        onClick={() => {
                          setFilter(option.value);
                          setFilterMenuOpen(false);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="skills-install-policy" aria-label="技能安装位置">
              <span>安装位置</span>
              <strong>全局技能目录</strong>
              <code title={skillRootLabel}>{skillRootLabel}</code>
              <Button size="small" type="button" variant="outline" onClick={onManageSkills}>
                打开目录
              </Button>
            </div>

            {filteredSkills.length > 0 ? (
              <div className="skills-catalog-grid">
                {filteredSkills.map((skill) => (
                  <button
                    className="skill-catalog-card"
                    key={skill.id}
                    type="button"
                    onClick={() => setSelectedSkillId(skill.id)}
                  >
                    <SkillGlyph />
                    <span className="skill-library-copy">
                      <strong>{skill.name}</strong>
                      <small>{skill.description || skillExcerpt(skill.content) || skill.skillPath}</small>
                    </span>
                    <span className={skill.enabled ? "skill-library-status enabled" : "skill-library-status"}>
                      {skill.enabled ? <CheckIcon size="17px" /> : <span className="skill-disabled-dot" />}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="skills-library-empty">
                <div className="skills-empty-panel">
                  <SkillGlyph />
                  <div>
                    <strong>{skills.length === 0 ? "还没有技能" : "没有匹配结果"}</strong>
                    <p>{skills.length === 0 ? "创建一个 SKILL.md 后，它会出现在这里并可直接注入对话。" : "换个关键词，或清空筛选后查看全部技能。"}</p>
                  </div>
                  <div className="skills-empty-actions">
                    {skills.length === 0 ? (
                      <>
                        <Button className="skills-empty-action-button primary" type="button" onClick={openCreateSkillDialog}>
                          创建技能
                        </Button>
                        <Button className="skills-empty-action-button" type="button" onClick={onManageSkills}>
                          管理目录
                        </Button>
                      </>
                    ) : (
                      <Button className="skills-empty-action-button" type="button" onClick={() => setQuery("")}>
                        清空搜索
                      </Button>
                    )}
                    <Button className="skills-empty-action-button" type="button" onClick={() => onRefresh()}>
                      刷新
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="skills-library-meta">
              <div className="skills-library-meta-copy">
                <span title={skillRootLabel}>{skillRootLabel}</span>
                {message ? <span title={message}>{message}</span> : null}
              </div>
              <button
                aria-label="刷新技能"
                className="skills-meta-refresh-action"
                title="刷新技能"
                type="button"
                onClick={() => onRefresh()}
              >
                <span>刷新</span>
              </button>
            </div>

            {errors.length > 0 ? (
              <div className="skills-library-errors">
                {errors.map((error) => (
                  <Tag key={error.path} theme="danger" variant="light">
                    {error.path}: {error.message}
                  </Tag>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <McpSourcesView
            message={mcpMessage}
            onAddServer={onAddMcpServer}
            onCallTool={onCallMcpTool}
            onInit={onInitMcp}
            onRefresh={onRefreshMcp}
            onReadResource={onReadMcpResource}
            onRemoveServer={onRemoveMcpServer}
            snapshot={mcpSnapshot}
            onStop={onStopMcp}
            onToggleServer={onToggleMcpServer}
            onUpdateServer={onUpdateMcpServer}
            onUsePrompt={onUseMcpPrompt}
            busyLabel={mcpBusyLabel}
          />
        )}
      </div>

      <SkillDetailDialog
        onClose={() => setSelectedSkillId(null)}
        onOpenSkillFolder={onOpenSkillFolder}
        onRenameSkill={onRenameSkill}
        onSelectSkill={onSelectSkill}
        onTrashSkill={onTrashSkill}
        onToggleSkill={onToggleSkill}
        onUpdateSkill={onUpdateSkill}
        skill={selectedSkill}
      />
      <Dialog
        cancelBtn="取消"
        className="skill-create-dialog"
        confirmBtn="创建技能"
        confirmLoading={false}
        header="创建技能"
        visible={showCreateDialog}
        width={720}
        onClose={() => setShowCreateDialog(false)}
        onConfirm={() => void submitCreateSkill()}
      >
        <div className="skill-create-form">
          <div className="skill-create-target">
            <span>安装位置</span>
            <strong>全局技能目录</strong>
            <code title={skillRootLabel}>{skillRootLabel}</code>
          </div>
          <div className="skill-create-grid">
            <Input
              label="ID"
              onChange={(value) => setCreateDraft((draft) => ({ ...draft, id: String(value).trim().toLowerCase().replace(/\s+/g, "-") }))}
              placeholder="code-review"
              value={createDraft.id}
            />
            <Input
              label="名称"
              onChange={(value) => setCreateDraft((draft) => ({ ...draft, name: String(value) }))}
              placeholder="Code Review"
              value={createDraft.name}
            />
          </div>
          <Input
            label="描述"
            onChange={(value) => setCreateDraft((draft) => ({ ...draft, description: String(value) }))}
            placeholder="什么时候应该使用这个技能"
            value={createDraft.description}
          />
          <Select
            label="模板"
            options={[
              { label: "通用", value: "general" },
              { label: "代码评审", value: "review" },
              { label: "CI 修复", value: "ci" },
              { label: "文档", value: "docs" }
            ]}
            value={createDraft.template}
            onChange={(value) => setCreateDraft((draft) => ({ ...draft, template: String(value) as SkillTemplate }))}
          />
          <label className="skill-create-textarea">
            <span>说明</span>
            <Textarea
              autosize={{ minRows: 6, maxRows: 12 }}
              onChange={(value) => setCreateDraft((draft) => ({ ...draft, body: String(value) }))}
              placeholder="留空会使用模板内容；也可以直接写 SKILL.md 主体。"
              value={createDraft.body}
            />
          </label>
          {createIssues.length > 0 ? (
            <div className="skill-create-issues">
              {createIssues.map((issue) => (
                <Tag key={`${issue.code}-${issue.message}`} theme={issue.severity === "error" ? "danger" : "warning"} variant="light">
                  {issue.message}
                </Tag>
              ))}
            </div>
          ) : null}
        </div>
      </Dialog>
    </section>
  );
}

function McpSourcesView({
  busyLabel,
  message,
  onAddServer,
  onCallTool,
  onInit,
  onRefresh,
  onReadResource,
  onRemoveServer,
  onStop,
  onToggleServer,
  onUpdateServer,
  onUsePrompt,
  snapshot
}: {
  busyLabel: string | null;
  message: string | null;
  onAddServer: (input: McpAddServerInput) => void;
  onCallTool: (input: { arguments: Record<string, unknown>; qualifiedName: string }) => Promise<McpCallOutput | null>;
  onInit: () => void;
  onRefresh: () => void;
  onReadResource: (resource: { serverName: string; uri: string }) => Promise<McpResourceReadOutput | null>;
  onRemoveServer: (name: string) => void;
  onStop: () => void;
  onToggleServer: (name: string, enabled: boolean) => void;
  onUpdateServer: (input: McpAddServerInput) => void;
  onUsePrompt: (prompt: { arguments?: Record<string, unknown>; name: string; serverName: string }) => Promise<McpPromptGetOutput | null>;
  snapshot: McpToolSnapshot | null;
}) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [serverName, setServerName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [args, setArgs] = useState("");
  const [framing, setFraming] = useState<"header" | "jsonl">("header");
  const [executeTimeout, setExecuteTimeout] = useState("5");
  const [mcpQuery, setMcpQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<McpStatusFilter>("all");

  const submitServer = () => {
    const name = serverName.trim();
    if (!name) {
      return;
    }
    onAddServer({
      name,
      ...(transport === "stdio"
        ? { command: command.trim(), args: splitArgs(args), framing, executeTimeout: Number(executeTimeout) || undefined }
        : { url: url.trim(), executeTimeout: Number(executeTimeout) || undefined })
    });
    setShowAddDialog(false);
    setServerName("");
    setCommand("");
    setUrl("");
    setArgs("");
    setFraming("header");
    setExecuteTimeout("5");
  };

  const applyPreset = (preset: McpPreset) => {
    setShowAddDialog(true);
    setServerName(preset.input.name);
    setExecuteTimeout(String(preset.input.executeTimeout ?? 20));
    if (preset.input.url) {
      setTransport("http");
      setUrl(preset.input.url);
      setCommand("");
      setArgs("");
      setFraming("header");
      return;
    }
    setTransport("stdio");
    setCommand(preset.input.command ?? "");
    setArgs((preset.input.args ?? []).join(" "));
    setUrl("");
    setFraming(preset.input.framing ?? "header");
  };

  if (!snapshot) {
    return (
      <div className="mcp-source-empty">
        <Empty description="点击刷新读取 ~/.ore-code/mcp.json。" title="MCP 尚未加载" />
        <div className="mcp-source-actions">
          <Button type="button" variant="outline" onClick={onInit}>初始化 MCP</Button>
          <Button theme="primary" type="button" onClick={onRefresh}>刷新 MCP</Button>
        </div>
      </div>
    );
  }

  const connectedCount = snapshot.servers.filter((server) => server.status === "connected").length;
  const failedCount = snapshot.servers.filter((server) => server.status === "failed").length;
  const disabledCount = snapshot.servers.filter((server) => server.status === "disabled").length;
  const statusText = message || snapshot.error || (snapshot.configured ? `${snapshot.tools.length} tools` : "未配置");
  const filteredServers = filterMcpServers(snapshot.servers, mcpQuery, statusFilter);

  return (
    <div className="mcp-sources-view">
      <div className="mcp-source-toolbar">
        <div className="mcp-source-heading">
          <span>MCP 状态</span>
          <strong>{busyLabel || (snapshot.supported ? statusText : "MCP 不可用")}</strong>
          <small>{snapshot.configPath}</small>
        </div>
        <div className="mcp-source-actions">
          <Button type="button" variant="outline" onClick={() => setShowAddDialog(true)}>添加 MCP</Button>
          {busyLabel ? <Button type="button" variant="outline" onClick={onStop}>停止</Button> : null}
          <Button disabled={Boolean(busyLabel)} loading={Boolean(busyLabel)} theme="primary" type="button" onClick={onRefresh}>重连</Button>
        </div>
      </div>

      <div className="mcp-source-stats" aria-label="MCP 概览">
        <div>
          <span>已连接</span>
          <strong>{connectedCount}</strong>
        </div>
        <div>
          <span>工具</span>
          <strong>{snapshot.tools.length}</strong>
        </div>
        <div>
          <span>资源</span>
          <strong>{snapshot.resources.length}</strong>
        </div>
        <div>
          <span>提示</span>
          <strong>{snapshot.prompts.length}</strong>
        </div>
        <div>
          <span>失败</span>
          <strong>{failedCount}</strong>
        </div>
        <div>
          <span>停用</span>
          <strong>{disabledCount}</strong>
        </div>
      </div>

      <div className="mcp-source-filterbar">
        <Input
          clearable
          placeholder="搜索 server、工具、资源或命令"
          prefixIcon={<SearchIcon size="16px" />}
          value={mcpQuery}
          onChange={(value) => setMcpQuery(String(value))}
        />
        <div className="mcp-status-filter" aria-label="MCP server 状态筛选">
          {mcpStatusFilters.map((item) => (
            <button
              className={statusFilter === item.value ? "active" : ""}
              key={item.value}
              type="button"
              onClick={() => setStatusFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {!snapshot.configured || !snapshot.supported ? (
        <div className="mcp-source-empty">
          <Empty
            description={snapshot.error || (snapshot.supported ? "创建 ~/.ore-code/mcp.json 后刷新。" : "浏览器预览不支持连接 MCP server。")}
            title={snapshot.supported ? "未配置 MCP" : "MCP 不可用"}
          />
        </div>
      ) : null}

      {snapshot.servers.length > 0 ? (
        <div className="mcp-server-list">
          {filteredServers.map((server) => (
            <McpServerCard
              key={server.name}
              onCallTool={onCallTool}
              onReadResource={onReadResource}
              onRemove={onRemoveServer}
              onToggle={onToggleServer}
              onUpdate={onUpdateServer}
              onUsePrompt={onUsePrompt}
              server={server}
              busy={Boolean(busyLabel)}
            />
          ))}
          {filteredServers.length === 0 ? (
            <div className="mcp-source-empty mcp-filter-empty">
              <strong>没有匹配的 MCP server</strong>
              <p>清空搜索或切换状态筛选后再试。</p>
              <Button size="small" type="button" variant="outline" onClick={() => {
                setMcpQuery("");
                setStatusFilter("all");
              }}>
                清空筛选
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Dialog
        cancelBtn="取消"
        className="mcp-add-dialog"
        confirmBtn="添加"
        header="添加 MCP server"
        placement="center"
        visible={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onConfirm={submitServer}
      >
        <div className="mcp-add-form">
          <div className="mcp-preset-list" aria-label="MCP 预设">
            <span>常用预设</span>
            <div>
              {mcpPresets.map((preset) => (
                <button key={preset.name} type="button" onClick={() => applyPreset(preset)}>
                  <strong>{preset.name}</strong>
                  <small>{preset.description}</small>
                  {preset.input.framing ? <code>{preset.input.framing}</code> : null}
                </button>
              ))}
            </div>
          </div>
          <Input label="名称" onChange={(value) => setServerName(String(value))} value={serverName} />
          <Select
            label="传输"
            options={[
              { label: "stdio", value: "stdio" },
              { label: "http", value: "http" }
            ]}
            value={transport}
            onChange={(value) => setTransport(String(value) as "stdio" | "http")}
          />
          {transport === "stdio" ? (
            <>
              <Input label="命令" onChange={(value) => setCommand(String(value))} value={command} />
              <Input label="参数" onChange={(value) => setArgs(String(value))} placeholder="用空格分隔" value={args} />
              <Select
                label="Framing"
                options={[
                  { label: "Content-Length header", value: "header" },
                  { label: "JSON line", value: "jsonl" }
                ]}
                value={framing}
                onChange={(value) => setFraming(String(value) as "header" | "jsonl")}
              />
            </>
          ) : (
            <Input label="URL" onChange={(value) => setUrl(String(value))} placeholder="http://127.0.0.1:3000/mcp" value={url} />
          )}
          <Input label="超时秒数" onChange={(value) => setExecuteTimeout(String(value).replace(/[^\d]/g, ""))} value={executeTimeout} />
        </div>
      </Dialog>
    </div>
  );
}

function McpServerCard({
  busy,
  onCallTool,
  onReadResource,
  onRemove,
  onToggle,
  onUpdate,
  onUsePrompt,
  server
}: {
  busy: boolean;
  onCallTool: (input: { arguments: Record<string, unknown>; qualifiedName: string }) => Promise<McpCallOutput | null>;
  onReadResource: (resource: { serverName: string; uri: string }) => Promise<McpResourceReadOutput | null>;
  onRemove: (name: string) => void;
  onToggle: (name: string, enabled: boolean) => void;
  onUpdate: (input: McpAddServerInput) => void;
  onUsePrompt: (prompt: { arguments?: Record<string, unknown>; name: string; serverName: string }) => Promise<McpPromptGetOutput | null>;
  server: McpServerSnapshot;
}) {
  const [preview, setPreview] = useState<McpResourceReadOutput | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [configVisible, setConfigVisible] = useState(false);
  const [promptArgs, setPromptArgs] = useState<{ name: string; value: string } | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
  const [toolInput, setToolInput] = useState("{}");
  const [toolResult, setToolResult] = useState<McpCallOutput | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const selectedTool = server.tools.find((tool) => tool.qualifiedName === selectedToolName) ?? null;

  const readResource = async (uri: string) => {
    const output = await onReadResource({ serverName: server.name, uri });
    if (!output) {
      return;
    }
    setPreview(output);
    setPreviewVisible(true);
  };

  const usePrompt = async (name: string) => {
    let parsedArgs: Record<string, unknown> | undefined;
    if (promptArgs?.name === name && promptArgs.value.trim()) {
      try {
        parsedArgs = JSON.parse(promptArgs.value) as Record<string, unknown>;
      } catch {
        parsedArgs = { input: promptArgs.value.trim() };
      }
    }
    await onUsePrompt({ serverName: server.name, name, arguments: parsedArgs });
  };

  const openTool = (qualifiedName: string) => {
    setSelectedToolName(qualifiedName);
    setToolInput("{}");
    setToolResult(null);
    setToolError(null);
  };

  const callTool = async () => {
    if (!selectedTool) {
      return;
    }
    let parsedArgs: Record<string, unknown>;
    try {
      const parsed = JSON.parse(toolInput || "{}") as unknown;
      parsedArgs = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : { input: parsed };
    } catch (error) {
      setToolError(error instanceof Error ? error.message : String(error));
      return;
    }
    setToolError(null);
    const output = await onCallTool({ qualifiedName: selectedTool.qualifiedName, arguments: parsedArgs });
    setToolResult(output);
  };

  return (
    <article className={`mcp-server-card ${server.status}`}>
      <header>
        <div className="mcp-server-title">
          <strong>{server.name}</strong>
          <small>{server.transport}{server.framing ? ` · ${server.framing}` : ""} · {server.toolCount} tools · {server.resourceCount} resources · {server.promptCount} prompts</small>
        </div>
        <div className="mcp-server-actions">
          <Tag theme={mcpStatusTheme(server.status)} variant="light">
            {mcpStatusText(server.status)}
          </Tag>
          <Button disabled={busy} size="small" type="button" variant="outline" onClick={() => setDetailVisible(true)}>详情</Button>
          <Button disabled={busy} size="small" type="button" variant="outline" onClick={() => setConfigVisible(true)}>配置</Button>
          <Switch
            disabled={busy}
            size="small"
            value={server.status !== "disabled"}
            onChange={(value) => onToggle(server.name, Boolean(value))}
          />
          <Button disabled={busy} size="small" theme="danger" type="button" variant="text" onClick={() => onRemove(server.name)}>删除</Button>
        </div>
      </header>
      {server.error ? <p>{server.error}</p> : null}
      {server.tools.length > 0 ? (
        <div className="mcp-tool-chips" aria-label={`${server.name} tools`}>
          {server.tools.slice(0, 5).map((tool) => (
            <button
              className={selectedToolName === tool.qualifiedName ? "active" : ""}
              key={tool.qualifiedName}
              title={tool.description || tool.qualifiedName}
              type="button"
              onClick={() => {
                openTool(tool.qualifiedName);
                setDetailVisible(true);
              }}
            >
              <code>{tool.name}</code>
            </button>
          ))}
          {server.tools.length > 5 ? <span>+{server.tools.length - 5}</span> : null}
        </div>
      ) : null}
      <Dialog
        cancelBtn={null}
        className="mcp-resource-dialog"
        confirmBtn="关闭"
        header={preview ? `MCP 资源：${preview.uri}` : "MCP 资源"}
        placement="center"
        visible={previewVisible}
        onClose={() => setPreviewVisible(false)}
        onConfirm={() => setPreviewVisible(false)}
      >
        <div className="mcp-resource-preview">
          {preview?.mimeType ? <Tag size="small" variant="light">{preview.mimeType}</Tag> : null}
          <pre>{preview?.text || JSON.stringify(preview?.content ?? {}, null, 2)}</pre>
        </div>
      </Dialog>
      <McpServerConfigDialog
        busy={busy}
        onClose={() => setConfigVisible(false)}
        onSubmit={onUpdate}
        server={server}
        visible={configVisible}
      />
      <Dialog
        cancelBtn={null}
        className="mcp-detail-dialog"
        confirmBtn="关闭"
        header={`MCP server：${server.name}`}
        placement="center"
        visible={detailVisible}
        width={760}
        onClose={() => setDetailVisible(false)}
        onConfirm={() => setDetailVisible(false)}
      >
        <div className="mcp-server-detail">
          <dl>
            <div><dt>状态</dt><dd>{mcpStatusText(server.status)}</dd></div>
            <div><dt>传输</dt><dd>{server.transport}</dd></div>
            <div><dt>命令</dt><dd><code>{server.command || server.url || "-"}</code></dd></div>
            <div><dt>参数</dt><dd><code>{server.args.length > 0 ? server.args.join(" ") : "-"}</code></dd></div>
            <div><dt>Framing</dt><dd>{server.framing || (server.transport === "stdio" ? "header / auto fallback" : "-")}</dd></div>
            <div><dt>连接超时</dt><dd>{server.connectTimeoutSecs ?? "-"}s</dd></div>
            <div><dt>超时</dt><dd>{server.executeTimeoutSecs}s</dd></div>
            <div><dt>环境变量</dt><dd>{Object.keys(server.env ?? {}).length}</dd></div>
            <div><dt>工具过滤</dt><dd>{`${(server.enabledTools ?? []).length} enabled / ${(server.disabledTools ?? []).length} disabled`}</dd></div>
          </dl>
          {server.error ? <pre className="mcp-server-error">{server.error}</pre> : null}
          {server.tools.length > 0 ? (
            <div className="mcp-tool-list" aria-label={`${server.name} tools`}>
              <div className="mcp-tool-list-header">
                <span>工具名</span>
                <span>说明</span>
                <span>权限</span>
              </div>
              {server.tools.map((tool) => (
                <button className={selectedToolName === tool.qualifiedName ? "mcp-tool-row active" : "mcp-tool-row"} key={tool.qualifiedName} type="button" onClick={() => openTool(tool.qualifiedName)}>
                  <code title={tool.qualifiedName}>{tool.qualifiedName}</code>
                  <span title={tool.description || tool.name}>{tool.description || tool.name}</span>
                  {tool.annotations?.readOnlyHint ? <Tag size="small" theme="success" variant="light">只读</Tag> : <Tag size="small" theme="warning" variant="light">需审批</Tag>}
                </button>
              ))}
            </div>
          ) : null}
          {server.resources.length > 0 ? (
            <McpPaletteGroup
              items={server.resources.map((resource) => ({
                id: resource.uri,
                label: resource.name,
                meta: resource.mimeType ?? resource.uri,
                actionLabel: "读取",
                onAction: () => void readResource(resource.uri)
              }))}
              title="资源"
            />
          ) : null}
          {server.prompts.length > 0 ? (
            <div className="mcp-palette-group">
              <strong>提示</strong>
              <div>
                {server.prompts.map((prompt) => (
                  <span key={prompt.name} title={`${prompt.name} · ${prompt.description || "prompt"}`}>
                    <span>{prompt.name}</span>
                    <button type="button" onClick={() => setPromptArgs(promptArgs?.name === prompt.name ? null : { name: prompt.name, value: "" })}>参数</button>
                    <button type="button" onClick={() => void usePrompt(prompt.name)}>应用</button>
                  </span>
                ))}
              </div>
              {promptArgs ? (
                <Input
                  placeholder='JSON 参数，如 {"topic":"workspace"}；非 JSON 会作为 input'
                  value={promptArgs.value}
                  onChange={(value) => setPromptArgs({ ...promptArgs, value: String(value) })}
                />
              ) : null}
            </div>
          ) : null}
          {selectedTool ? (
            <div className="mcp-tool-detail">
              <header>
                <div>
                  <strong>{selectedTool.qualifiedName}</strong>
                  <span>{selectedTool.description || selectedTool.name}</span>
                </div>
                <Button disabled={busy || server.status !== "connected"} size="small" theme="primary" type="button" onClick={() => void callTool()}>测试调用</Button>
              </header>
              <div className="mcp-tool-detail-grid">
                <label>
                  <span>Schema</span>
                  <pre>{JSON.stringify(selectedTool.inputSchema ?? {}, null, 2)}</pre>
                </label>
                <label>
                  <span>参数 JSON</span>
                  <Textarea autosize={{ minRows: 7, maxRows: 14 }} value={toolInput} onChange={(value) => setToolInput(String(value))} />
                </label>
              </div>
              {toolError ? <pre className="mcp-server-error">{toolError}</pre> : null}
              {toolResult ? <pre className="mcp-tool-result">{JSON.stringify(toolResult.content, null, 2)}</pre> : null}
            </div>
          ) : (
            <p className="mcp-detail-hint">点击工具行查看 schema，并可手动填 JSON 测试调用。</p>
          )}
        </div>
      </Dialog>
    </article>
  );
}

function McpPaletteGroup({ items, title }: { items: Array<{ actionLabel?: string; id: string; label: string; meta: string; onAction?: () => void }>; title: string }) {
  return (
    <div className="mcp-palette-group">
      <strong>{title}</strong>
      <div>
        {items.map((item) => (
          <span key={item.id} title={`${item.label} · ${item.meta}`}>
            <span>{item.label}</span>
            {item.onAction ? <button type="button" onClick={item.onAction}>{item.actionLabel ?? "打开"}</button> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function McpServerConfigDialog({
  busy,
  onClose,
  onSubmit,
  server,
  visible
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: McpAddServerInput) => void;
  server: McpServerSnapshot;
  visible: boolean;
}) {
  const [draft, setDraft] = useState<McpServerDraft>(() => draftFromMcpServer(server));
  const preview = useMemo(() => buildMcpServerConfigPreview(draft), [draft]);

  useEffect(() => {
    if (visible) {
      setDraft(draftFromMcpServer(server));
    }
  }, [server.name, visible]);

  const updateDraft = (patch: Partial<McpServerDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const submit = () => {
    if (preview.error) {
      return;
    }
    onSubmit(mcpInputFromDraft(draft));
    onClose();
  };

  return (
    <Dialog
      cancelBtn="取消"
      className="mcp-config-dialog"
      confirmBtn="保存配置"
      confirmLoading={busy}
      header={`编辑 MCP：${server.name}`}
      placement="center"
      visible={visible}
      width={1020}
      onClose={onClose}
      onConfirm={submit}
    >
      <div className="mcp-config-form">
        <div className="mcp-config-main">
          <div className="mcp-config-editor">
            <section className="mcp-config-section">
              <div className="mcp-config-section-title">基础</div>
              <div className="mcp-config-grid">
                <label className="mcp-config-control">
                  <span>名称</span>
                  <Input disabled value={draft.name} />
                </label>
                <label className="mcp-config-switch">
                  <span>启用</span>
                  <Switch value={draft.enabled} onChange={(value) => updateDraft({ enabled: Boolean(value) })} />
                </label>
                <label className="mcp-config-control">
                  <span>传输</span>
                  <Select
                    options={[
                      { label: "stdio", value: "stdio" },
                      { label: "http", value: "http" }
                    ]}
                    value={draft.transport}
                    onChange={(value) => updateDraft({ transport: String(value) as "stdio" | "http" })}
                  />
                </label>
                <label className="mcp-config-control">
                  <span>连接超时</span>
                  <Input value={draft.connectTimeout} onChange={(value) => updateDraft({ connectTimeout: numericText(value) })} />
                </label>
                <label className="mcp-config-control">
                  <span>执行超时</span>
                  <Input value={draft.executeTimeout} onChange={(value) => updateDraft({ executeTimeout: numericText(value) })} />
                </label>
              </div>
            </section>

            <section className="mcp-config-section">
              <div className="mcp-config-section-title">{draft.transport === "stdio" ? "启动命令" : "HTTP"}</div>
              {draft.transport === "stdio" ? (
                <div className="mcp-config-grid">
                  <label className="mcp-config-control wide">
                    <span>Command</span>
                    <Input value={draft.command} onChange={(value) => updateDraft({ command: String(value) })} />
                  </label>
                  <label className="mcp-config-control">
                    <span>Framing</span>
                    <Select
                      options={[
                        { label: "Content-Length header", value: "header" },
                        { label: "JSON line", value: "jsonl" }
                      ]}
                      value={draft.framing}
                      onChange={(value) => updateDraft({ framing: String(value) as "header" | "jsonl" })}
                    />
                  </label>
                  <label className="mcp-config-field wide">
                    <span>Args</span>
                    <Textarea
                      autosize={{ minRows: 5, maxRows: 5 }}
                      placeholder={"每行一个参数\n-y\n@playwright/mcp@latest"}
                      value={draft.args}
                      onChange={(value) => updateDraft({ args: String(value) })}
                    />
                  </label>
                </div>
              ) : (
                <label className="mcp-config-control">
                  <span>URL</span>
                  <Input value={draft.url} onChange={(value) => updateDraft({ url: String(value) })} />
                </label>
              )}
            </section>

            <section className="mcp-config-section">
              <div className="mcp-config-section-title">环境与工具过滤</div>
              <div className="mcp-config-two-col">
                <label className="mcp-config-field">
                  <span>Env</span>
                  <Textarea
                    autosize={{ minRows: 8, maxRows: 8 }}
                    placeholder="每行一个 KEY=value"
                    value={draft.env}
                    onChange={(value) => updateDraft({ env: String(value) })}
                  />
                </label>
                <div className="mcp-config-tools">
                  <label className="mcp-config-field">
                    <span>enabled_tools</span>
                    <Textarea
                      autosize={{ minRows: 3, maxRows: 3 }}
                      placeholder="每行或逗号分隔一个工具名"
                      value={draft.enabledTools}
                      onChange={(value) => updateDraft({ enabledTools: String(value) })}
                    />
                  </label>
                  <label className="mcp-config-field">
                    <span>disabled_tools</span>
                    <Textarea
                      autosize={{ minRows: 3, maxRows: 3 }}
                      placeholder="每行或逗号分隔一个工具名"
                      value={draft.disabledTools}
                      onChange={(value) => updateDraft({ disabledTools: String(value) })}
                    />
                  </label>
                </div>
              </div>
            </section>
          </div>

          <aside className="mcp-config-preview">
            <header>
              <strong>JSON 预览</strong>
              <Tag theme={preview.error ? "danger" : "success"} variant="light">
                {preview.error ? "校验失败" : "校验通过"}
              </Tag>
            </header>
            {preview.error ? <p>{preview.error}</p> : null}
            <pre>{preview.json}</pre>
          </aside>
        </div>
      </div>
    </Dialog>
  );
}

function filterMcpServers(servers: McpServerSnapshot[], query: string, statusFilter: McpStatusFilter) {
  const keyword = query.trim().toLowerCase();

  return servers.filter((server) => {
    if (statusFilter !== "all" && server.status !== statusFilter) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    return mcpServerSearchText(server).includes(keyword);
  });
}

function mcpServerSearchText(server: McpServerSnapshot) {
  return [
    server.name,
    server.status,
    server.transport,
    server.framing,
    server.command,
    server.url,
    server.args.join(" "),
    Object.entries(server.env ?? {}).map(([key, value]) => `${key}=${value}`).join(" "),
    (server.enabledTools ?? []).join(" "),
    (server.disabledTools ?? []).join(" "),
    server.error,
    ...server.tools.flatMap((tool) => [tool.name, tool.qualifiedName, tool.description]),
    ...server.resources.flatMap((resource) => [resource.name, resource.uri, resource.mimeType]),
    ...server.prompts.flatMap((prompt) => [prompt.name, prompt.description])
  ].filter(Boolean).join(" ").toLowerCase();
}

function splitArgs(value: string) {
  return value.trim().split(/\s+/).filter(Boolean);
}

function draftFromMcpServer(server: McpServerSnapshot): McpServerDraft {
  const env = server.env ?? {};
  return {
    args: formatList(server.args),
    command: server.command ?? "",
    connectTimeout: String(server.connectTimeoutSecs ?? server.executeTimeoutSecs ?? 5),
    disabledTools: formatList(server.disabledTools ?? []),
    enabled: server.status !== "disabled",
    enabledTools: formatList(server.enabledTools ?? []),
    env: Object.keys(env)
      .sort()
      .map((key) => `${key}=${env[key]}`)
      .join("\n"),
    executeTimeout: String(server.executeTimeoutSecs ?? 5),
    framing: server.framing === "jsonl" ? "jsonl" : "header",
    name: server.name,
    transport: server.transport === "http" ? "http" : "stdio",
    url: server.url ?? ""
  };
}

function mcpInputFromDraft(draft: McpServerDraft): McpAddServerInput {
  const config = mcpServerConfigFromDraft(draft);
  return {
    name: draft.name,
    args: config.args,
    command: config.command,
    connectTimeout: config.connectTimeout,
    disabled: !draft.enabled,
    disabledTools: config.disabledTools,
    enabledTools: config.enabledTools,
    env: config.env,
    executeTimeout: config.executeTimeout,
    framing: config.framing,
    url: config.url
  };
}

function buildMcpServerConfigPreview(draft: McpServerDraft) {
  try {
    const config = mcpServerConfigFromDraft(draft);
    return {
      error: null as string | null,
      json: JSON.stringify(config.json, null, 2)
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      json: "{}"
    };
  }
}

function mcpServerConfigFromDraft(draft: McpServerDraft) {
  const connectTimeout = optionalPositiveNumber(draft.connectTimeout, "连接超时秒数");
  const executeTimeout = optionalPositiveNumber(draft.executeTimeout, "执行超时秒数");
  const args = parseArgLines(draft.args);
  const enabledTools = parseListLines(draft.enabledTools);
  const disabledTools = parseListLines(draft.disabledTools);
  const env = parseEnvLines(draft.env);
  const json: Record<string, unknown> = {};
  let command: string | undefined;
  let url: string | undefined;

  if (draft.transport === "http") {
    url = draft.url.trim();
    if (!url) {
      throw new Error("HTTP MCP server 需要 URL。");
    }
    json.url = url;
  } else {
    command = draft.command.trim();
    if (!command) {
      throw new Error("stdio MCP server 需要 Command。");
    }
    json.command = command;
    if (args.length > 0) {
      json.args = args;
    }
    json.framing = draft.framing;
  }

  if (Object.keys(env).length > 0) {
    json.env = env;
  }
  if (connectTimeout !== undefined) {
    json.connect_timeout = connectTimeout;
  }
  if (executeTimeout !== undefined) {
    json.execute_timeout = executeTimeout;
  }
  if (enabledTools.length > 0) {
    json.enabled_tools = enabledTools;
  }
  if (disabledTools.length > 0) {
    json.disabled_tools = disabledTools;
  }
  if (!draft.enabled) {
    json.disabled = true;
  }

  return {
    args: draft.transport === "stdio" ? args : undefined,
    command,
    connectTimeout,
    disabledTools,
    enabledTools,
    env,
    executeTimeout,
    framing: draft.transport === "stdio" ? draft.framing : undefined,
    json,
    url
  };
}

function optionalPositiveNumber(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label}必须是正整数。`);
  }
  return parsed;
}

function parseListLines(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgLines(value: string) {
  return value
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEnvLines(value: string) {
  const env: Record<string, string> = {};
  for (const line of value.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Env 行必须是 KEY=value：${trimmed}`);
    }
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Env key 不合法：${key}`);
    }
    env[key] = trimmed.slice(separator + 1);
  }
  return env;
}

function formatList(values: string[]) {
  return values.join("\n");
}

function numericText(value: unknown) {
  return String(value).replace(/[^\d]/g, "");
}

function mcpStatusText(status: McpServerSnapshot["status"]) {
  switch (status) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "disabled":
      return "已停用";
    case "failed":
      return "失败";
    case "unsupported":
      return "不可用";
    case "missing":
      return "未配置";
  }
}

function mcpStatusTheme(status: McpServerSnapshot["status"]) {
  switch (status) {
    case "connected":
      return "success";
    case "connecting":
      return "warning";
    case "disabled":
    case "missing":
      return "default";
    case "failed":
    case "unsupported":
      return "danger";
  }
}

function SkillDetailDialog({
  onClose,
  onOpenSkillFolder,
  onRenameSkill,
  onSelectSkill,
  onTrashSkill,
  onToggleSkill,
  onUpdateSkill,
  skill
}: {
  onClose: () => void;
  onOpenSkillFolder: (skill: SkillRecord) => Promise<void>;
  onRenameSkill: (skill: SkillRecord, nextId: string) => Promise<void>;
  onSelectSkill: (skill: SkillRecord) => void;
  onTrashSkill: (skill: SkillRecord) => Promise<void>;
  onToggleSkill: (skillId: string, enabled: boolean) => void;
  onUpdateSkill: (skill: SkillRecord, content: string) => Promise<void>;
  skill: SkillRecord | null;
}) {
  const [editVisible, setEditVisible] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const editIssues = useMemo(() => validateSkillContent(editContent), [editContent]);
  const hasEditErrors = editIssues.some((issue) => issue.severity === "error");

  useEffect(() => {
    setEditContent(skill?.content ?? "");
    setEditVisible(false);
    setRenameDraft(skill?.id ?? "");
    setRenameVisible(false);
  }, [skill?.id]);

  const submitUpdate = async () => {
    if (!skill || hasEditErrors) {
      return;
    }
    await onUpdateSkill(skill, editContent);
    setEditVisible(false);
  };

  const submitRename = async () => {
    if (!skill || !renameDraft.trim() || renameDraft.trim() === skill.id) {
      setRenameVisible(false);
      return;
    }
    await onRenameSkill(skill, renameDraft.trim());
    setRenameVisible(false);
    onClose();
  };

  const submitTrash = async () => {
    if (!skill || !window.confirm(`删除技能 ${skill.name}？`)) {
      return;
    }
    await onTrashSkill(skill);
    onClose();
  };

  return (
    <>
      <Dialog
        className="skill-detail-dialog"
        closeBtn={false}
        confirmBtn={null}
        footer={false}
        header={false}
        onClose={onClose}
        visible={Boolean(skill)}
        width={940}
      >
        {skill ? (
          <div className="skill-detail">
            <header className="skill-detail-header">
              <SkillGlyph large />
              <Button aria-label="关闭技能详情" icon={<CloseIcon size="20px" />} shape="circle" type="button" variant="text" onClick={onClose} />
            </header>

            <div className="skill-detail-title-row">
              <div>
                <h2>{skill.name} <span>技能</span></h2>
                <p>{skill.description || "这个技能会在对话中注入 SKILL.md 中定义的工作流说明。"}</p>
              </div>
              <div className="skill-detail-controls">
                <Switch
                  size="large"
                  value={skill.enabled}
                  onChange={(value) => onToggleSkill(skill.id, Boolean(value))}
                />
                <Dropdown
                  options={[
                    { content: "编辑 SKILL.md", value: "edit" },
                    { content: "打开目录", value: "open" },
                    { content: "重命名", value: "rename" },
                    { content: "删除", value: "trash" }
                  ]}
                  trigger="click"
                  onClick={(option) => {
                    if (option.value === "edit") {
                      setEditContent(skill.content);
                      setEditVisible(true);
                    }
                    if (option.value === "open") {
                      void onOpenSkillFolder(skill);
                    }
                    if (option.value === "rename") {
                      setRenameVisible(true);
                    }
                    if (option.value === "trash") {
                      void submitTrash();
                    }
                  }}
                >
                  <Button aria-label="更多技能操作" icon={<MoreIcon size="20px" />} shape="circle" type="button" variant="text" />
                </Dropdown>
              </div>
            </div>

            <div className="skill-detail-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripFrontmatter(skill.content)}</ReactMarkdown>
            </div>

            <footer className="skill-detail-footer">
              <Button
                className="skill-uninstall-button"
                theme={skill.enabled ? "danger" : "primary"}
                type="button"
                variant="base"
                onClick={() => onToggleSkill(skill.id, !skill.enabled)}
              >
                {skill.enabled ? "停用" : "启用"}
              </Button>
              <Button
                className="skill-use-button"
                disabled={!skill.enabled}
                icon={<ComponentGridIcon size="18px" />}
                shape="round"
                theme="default"
                type="button"
                onClick={() => onSelectSkill(skill)}
              >
                在对话中试用
              </Button>
            </footer>
          </div>
        ) : null}
      </Dialog>
      <Dialog
        cancelBtn="取消"
        className="skill-edit-dialog"
        confirmBtn="保存"
        header="编辑 SKILL.md"
        visible={editVisible}
        width={760}
        onClose={() => setEditVisible(false)}
        onConfirm={() => void submitUpdate()}
      >
        <div className="skill-edit-form">
          <Textarea
            autosize={{ minRows: 14, maxRows: 22 }}
            value={editContent}
            onChange={(value) => setEditContent(String(value))}
          />
          {editIssues.length > 0 ? (
            <div className="skill-create-issues">
              {editIssues.map((issue) => (
                <Tag key={`${issue.code}-${issue.message}`} theme={issue.severity === "error" ? "danger" : "warning"} variant="light">
                  {issue.message}
                </Tag>
              ))}
            </div>
          ) : null}
        </div>
      </Dialog>
      <Dialog
        cancelBtn="取消"
        confirmBtn="重命名"
        header="重命名技能"
        visible={renameVisible}
        onClose={() => setRenameVisible(false)}
        onConfirm={() => void submitRename()}
      >
        <div className="skill-rename-form">
          <Input label="新 ID" value={renameDraft} onChange={(value) => setRenameDraft(String(value).trim().toLowerCase().replace(/\s+/g, "-"))} />
        </div>
      </Dialog>
    </>
  );
}

function SkillGlyph({ large = false }: { large?: boolean }) {
  return (
    <span className={large ? "skill-glyph large" : "skill-glyph"} aria-hidden="true">
      <span />
    </span>
  );
}

function skillExcerpt(content: string) {
  return stripFrontmatter(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("```"))
    .slice(0, 2)
    .join(" ")
    .slice(0, 90);
}

function stripFrontmatter(content: string) {
  if (!content.startsWith("---")) {
    return content.trim();
  }

  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return content.trim();
  }

  return content.slice(end + 4).trim();
}
