import type { ToolRegistry, ToolSpec } from "@ore-code/tools";

export type ToolPromptHintSource = ToolRegistry | readonly ToolSpec[] | readonly string[];

const LEGACY_PROMPT_TOOL_NAMES = [
  "agent_spawn",
  "agent_wait",
  "apply_patch",
  "automation_create",
  "checklist_write",
  "code_execution",
  "edit_file",
  "exec_shell",
  "fetch_url",
  "file_search",
  "git_blame",
  "git_branch",
  "git_diff",
  "git_log",
  "git_show",
  "git_status",
  "grep_files",
  "install_skill",
  "list_dir",
  "lsp_definition",
  "lsp_diagnostics",
  "lsp_document_symbols",
  "lsp_hover",
  "lsp_references",
  "mcp_apply_prompt",
  "mcp_call_tool",
  "mcp_list_tools",
  "mcp_read_resource",
  "note_list",
  "note_read",
  "read_file",
  "retrieve_tool_result",
  "rlm_query",
  "run_tests",
  "structured_review",
  "task_create",
  "tool_search",
  "validate_data",
  "web_search",
  "write_file"
] as const;

export function toolNamesFromPromptHintSource(source?: ToolPromptHintSource): string[] | undefined {
  if (!source) {
    return undefined;
  }

  if (isToolRegistry(source)) {
    return sortedUnique(source.list().map((tool) => tool.name));
  }

  if (source.length === 0) {
    return [];
  }

  if (typeof source[0] === "string") {
    return sortedUnique(source as readonly string[]);
  }

  return sortedUnique((source as readonly ToolSpec[]).map((tool) => tool.name));
}

export function toolNameSetFromPromptHintSource(source?: ToolPromptHintSource): Set<string> | undefined {
  const names = toolNamesFromPromptHintSource(source);
  return names ? new Set(names) : undefined;
}

export function hasPromptTool(source: ToolPromptHintSource | undefined, ...names: string[]) {
  const registered = toolNameSetFromPromptHintSource(source);
  if (!registered) {
    return names.some((name) => LEGACY_PROMPT_TOOL_NAMES.includes(name as typeof LEGACY_PROMPT_TOOL_NAMES[number]));
  }
  return names.some((name) => registered.has(name));
}

export function toolPromptHintLines(source?: ToolPromptHintSource): string[] {
  const registered = toolNameSetFromPromptHintSource(source);
  const has = (...names: string[]) => {
    if (!registered) {
      return names.some((name) => LEGACY_PROMPT_TOOL_NAMES.includes(name as typeof LEGACY_PROMPT_TOOL_NAMES[number]));
    }
    return names.some((name) => registered.has(name));
  };

  const lines = [
    "Tool selection guide:",
    "Use only currently registered tools; do not invent tools that are not available.",
    "Prefer typed tools over exec_shell whenever they cover the task; exec_shell is the fallback for commands without a structured tool."
  ];

  if (has("read_file")) {
    lines.push("Read files with read_file, not cat/head/tail.");
  }
  if (has("list_dir")) {
    lines.push("List directories with list_dir, not ls/dir/tree.");
  }
  if (has("grep_files")) {
    lines.push("Search file contents with grep_files, not rg/grep/findstr.");
  }
  if (has("file_search")) {
    lines.push("Search file names with file_search, not find/where/Get-ChildItem.");
  }
  if (has("read_file", "list_dir")) {
    lines.push("Prefer read_file or list_dir before changing code unless the user supplied exact file content.");
  }
  if (has("edit_file", "apply_patch")) {
    lines.push("Use edit_file for one exact replacement and apply_patch for structured multi-line modifications.");
  }
  if (has("git_status", "git_diff", "git_log", "git_show", "git_blame", "git_branch")) {
    lines.push("Inspect Git status, diffs, history, blame, and branches with git_status, git_diff, git_log, git_show, git_blame, and git_branch, not raw git commands.");
  }
  if (has("run_tests")) {
    lines.push("Use run_tests for test validation when available; use exec_shell only for non-test commands or when run_tests is unavailable.");
    lines.push("Run test validation with run_tests before shelling out to pnpm/npm/yarn/bun/cargo/pytest/vitest test commands.");
  }
  if (has("structured_review")) {
    lines.push("Use structured_review for code review over files, diffs, revisions, or PR diffs before asking the model to summarize large patches.");
  }
  if (has("validate_data")) {
    lines.push("Use validate_data after editing JSON, TOML, or YAML files, or when the user asks to check structured configuration data.");
  }
  if (has("code_execution")) {
    lines.push("Use code_execution for deterministic statistics, JSON/CSV aggregation, and lightweight data processing; do not use it for filesystem, network, subprocess, or package installation.");
  }
  if (has("install_skill")) {
    lines.push("Use install_skill when the user asks to install, create, or save an Ore Code skill; it writes only to the global user skill directory.");
    lines.push("Install Ore Code skills with install_skill, not write_file/apply_patch/exec_shell, and never create workspace .ore-code/skills unless the user explicitly asks to edit project files.");
  }
  if (has("tool_search")) {
    lines.push("Use tool_search when you are unsure which tool or MCP capability is available instead of guessing tool names.");
  }
  if (has("mcp_list_tools", "mcp_call_tool", "mcp_read_resource", "mcp_apply_prompt")) {
    lines.push("Use MCP through the stable gateway tools: call mcp_list_tools first, then mcp_call_tool, mcp_read_resource, or mcp_apply_prompt with the returned server/tool/resource/prompt identifiers.");
  }
  if (has("lsp_hover", "lsp_definition", "lsp_references", "lsp_document_symbols")) {
    lines.push("Use lsp_hover, lsp_definition, lsp_references, and lsp_document_symbols for code navigation when line/symbol context is needed.");
  }
  if (has("web_search", "fetch_url")) {
    lines.push("Use web_search and fetch_url when the user asks for current web information, docs, releases, or a specific URL; when web_search returns citations, cite the relevant citation ids in your answer.");
  }
  if (has("note_list", "note_read")) {
    lines.push("Use note_list to inspect durable memory indexes and note_read to load only relevant memory bodies.");
  }
  if (has("lsp_diagnostics")) {
    lines.push("After editing code, use lsp_diagnostics when available to collect language diagnostics before finalizing.");
  }
  if (has("task_create", "checklist_write")) {
    lines.push("For long-running or multi-step work, create a durable task, keep its checklist current, and record verification gates and PR attempts as evidence.");
  }
  if (has("automation_create")) {
    lines.push("For recurring work, use automation tools to create, inspect, update, pause, resume, run, or delete scheduled automations.");
  }
  if (has("retrieve_tool_result")) {
    lines.push("When a tool result includes an artifactId or long truncated output, use retrieve_tool_result to inspect the needed head, tail, or line range instead of guessing from the preview.");
  }

  return lines;
}

function isToolRegistry(source: ToolPromptHintSource): source is ToolRegistry {
  return typeof (source as ToolRegistry).list === "function";
}

function sortedUnique(names: readonly string[]) {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
