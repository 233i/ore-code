import type { ModelStreamChunk } from "@ore-code/agent-core";

export function planMockTurn(prompt: string): ModelStreamChunk[] {
  const trimmedPrompt = prompt.trim();
  const path = extractPath(trimmedPrompt);

  if (isMcpToolIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会调用已连接的 MCP 工具，" },
      {
        type: "tool_call",
        call: {
          id: "mcp-tool-1",
          name: "mcp_call_tool",
          input: {
            qualifiedName: extractMcpToolName(trimmedPrompt),
            arguments: extractMcpToolInput(trimmedPrompt)
          }
        }
      },
      { type: "done", finalText: " MCP 工具结果会显示在工具卡片里。" }
    ];
  }

  if (isPatchIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会通过受控补丁修改文件，" },
      {
        type: "tool_call",
        call: {
          id: "apply-patch-1",
          name: "apply_patch",
          input: {
            patch: extractPatch(trimmedPrompt)
          }
        }
      },
      { type: "done", finalText: " 补丁结果会显示在工具卡片里。" }
    ];
  }

  if (isGitDiffIntent(trimmedPrompt) && !isStructuredReviewIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会读取当前 Git diff，" },
      {
        type: "tool_call",
        call: {
          id: "git-diff-1",
          name: "git_diff",
          input: {
            staged: /--staged|--cached|暂存|已暂存/i.test(trimmedPrompt),
            ...(path !== "." ? { path } : {})
          }
        }
      },
      { type: "done", finalText: " diff 结果会显示在工具卡片里。" }
    ];
  }

  if (isStructuredReviewIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会运行结构化代码评审，" },
      {
        type: "tool_call",
        call: {
          id: "structured-review-1",
          name: "structured_review",
          input: buildStructuredReviewInput(trimmedPrompt, path)
        }
      },
      { type: "done", finalText: " 评审结果会显示在工具卡片里。" }
    ];
  }

  if (isValidateDataIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会校验结构化数据，" },
      {
        type: "tool_call",
        call: {
          id: "validate-data-1",
          name: "validate_data",
          input: buildValidateDataInput(trimmedPrompt, path)
        }
      },
      { type: "done", finalText: " 校验结果会显示在工具卡片里。" }
    ];
  }

  if (isToolSearchIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会搜索当前可用工具，" },
      {
        type: "tool_call",
        call: {
          id: "tool-search-1",
          name: "tool_search",
          input: { query: extractToolSearchQuery(trimmedPrompt) }
        }
      },
      { type: "done", finalText: " 工具搜索结果会显示在工具卡片里。" }
    ];
  }

  if (isCodeExecutionIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会用受控 Python 执行确定性计算，" },
      {
        type: "tool_call",
        call: {
          id: "code-execution-1",
          name: "code_execution",
          input: {
            language: "python",
            code: extractPythonCode(trimmedPrompt)
          }
        }
      },
      { type: "done", finalText: " 执行结果会显示在工具卡片里。" }
    ];
  }

  if (isLspIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会读取代码导航信息，" },
      {
        type: "tool_call",
        call: {
          id: "lsp-1",
          name: lspToolName(trimmedPrompt),
          input: buildLspInput(trimmedPrompt, path)
        }
      },
      { type: "done", finalText: " LSP-style 结果会显示在工具卡片里。" }
    ];
  }

  if (isGitBranchIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会读取当前 Git 分支信息，" },
      {
        type: "tool_call",
        call: {
          id: "git-branch-1",
          name: "git_branch",
          input: {}
        }
      },
      { type: "done", finalText: " 分支结果会显示在工具卡片里。" }
    ];
  }

  if (isGitLogIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会读取最近 Git 提交历史，" },
      {
        type: "tool_call",
        call: {
          id: "git-log-1",
          name: "git_log",
          input: { maxCount: 20 }
        }
      },
      { type: "done", finalText: " log 结果会显示在工具卡片里。" }
    ];
  }

  if (isGitShowIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会读取指定 Git revision，" },
      {
        type: "tool_call",
        call: {
          id: "git-show-1",
          name: "git_show",
          input: {
            rev: extractGitRevision(trimmedPrompt),
            ...(path !== "." ? { path } : {})
          }
        }
      },
      { type: "done", finalText: " show 结果会显示在工具卡片里。" }
    ];
  }

  if (isGitBlameIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会读取文件 blame 信息，" },
      {
        type: "tool_call",
        call: {
          id: "git-blame-1",
          name: "git_blame",
          input: { path }
        }
      },
      { type: "done", finalText: " blame 结果会显示在工具卡片里。" }
    ];
  }

  if (isGitStatusIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会读取当前 Git 状态，" },
      {
        type: "tool_call",
        call: {
          id: "git-status-1",
          name: "git_status",
          input: {}
        }
      },
      { type: "done", finalText: " status 结果会显示在工具卡片里。" }
    ];
  }

  if (isGrepIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会搜索文件内容，" },
      {
        type: "tool_call",
        call: {
          id: "grep-files-1",
          name: "grep_files",
          input: {
            path,
            pattern: extractSearchQuery(trimmedPrompt),
            caseSensitive: /case-sensitive|区分大小写/.test(trimmedPrompt)
          }
        }
      },
      { type: "done", finalText: " 搜索结果会显示在工具卡片里。" }
    ];
  }

  if (isFileSearchIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会按文件名搜索工作区，" },
      {
        type: "tool_call",
        call: {
          id: "file-search-1",
          name: "file_search",
          input: {
            path,
            query: extractSearchQuery(trimmedPrompt)
          }
        }
      },
      { type: "done", finalText: " 匹配路径会显示在工具卡片里。" }
    ];
  }

  if (isEditIntent(trimmedPrompt)) {
    const edit = extractEdit(trimmedPrompt);
    return [
      { type: "reasoning_delta", text: "我会做一次精确文本替换，" },
      {
        type: "tool_call",
        call: {
          id: "edit-file-1",
          name: "edit_file",
          input: {
            path,
            oldText: edit.oldText,
            newText: edit.newText
          }
        }
      },
      { type: "done", finalText: " 替换结果会显示在工具卡片里。" }
    ];
  }

  if (isShellJobOutputIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会读取后台任务输出，" },
      {
        type: "tool_call",
        call: {
          id: "shell-job-output-1",
          name: "shell_job_output",
          input: {
            jobId: extractJobId(trimmedPrompt)
          }
        }
      },
      { type: "done", finalText: " stdout/stderr 会显示在工具卡片里。" }
    ];
  }

  if (isShellJobStatusIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会查询后台任务状态，" },
      {
        type: "tool_call",
        call: {
          id: "shell-job-status-1",
          name: "shell_job_status",
          input: {
            jobId: extractJobId(trimmedPrompt)
          }
        }
      },
      { type: "done", finalText: " 状态摘要会显示在工具卡片里。" }
    ];
  }

  if (isBackgroundShellIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会把命令放到后台任务中执行，" },
      {
        type: "tool_call",
        call: {
          id: "start-shell-job-1",
          name: "start_shell_job",
          input: {
            command: extractShellCommand(trimmedPrompt),
            timeoutMs: 300_000
          }
        }
      },
      { type: "done", finalText: " job id 和状态会显示在工具卡片与 Jobs 面板里。" }
    ];
  }

  if (isRunTestsIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会通过测试工具执行验证，" },
      {
        type: "tool_call",
        call: {
          id: "run-tests-1",
          name: "run_tests",
          input: buildRunTestsInput(trimmedPrompt)
        }
      },
      { type: "done", finalText: " 测试结果会显示在工具卡片里。" }
    ];
  }

  if (isShellIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会通过受控 shell 执行命令，" },
      {
        type: "tool_call",
        call: {
          id: "exec-shell-1",
          name: "exec_shell",
          input: {
            command: extractShellCommand(trimmedPrompt)
          }
        }
      },
      { type: "done", finalText: " 命令结果会显示在工具卡片里。" }
    ];
  }

  if (isWriteIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会先准备一次受控写入，" },
      {
        type: "tool_call",
        call: {
          id: "write-file-1",
          name: "write_file",
          input: {
            path,
            content: buildWriteContent(trimmedPrompt)
          }
        }
      },
      { type: "done", finalText: " 写入请求已按当前模式处理。" }
    ];
  }

  if (isReadIntent(trimmedPrompt)) {
    return [
      { type: "reasoning_delta", text: "我会读取指定文件，" },
      {
        type: "tool_call",
        call: {
          id: "read-file-1",
          name: "read_file",
          input: { path }
        }
      },
      { type: "done", finalText: " 文件内容已返回。" }
    ];
  }

  return [
    { type: "reasoning_delta", text: "我会先建立只读上下文，" },
    {
      type: "tool_call",
      call: {
        id: "list-dir-1",
        name: "list_dir",
        input: { path }
      }
    },
    { type: "done", finalText: " 文件工具链路已连通。" }
  ];
}

function extractPath(prompt: string): string {
  const mentionedPath = prompt.match(/@(\S+)/)?.[1];
  if (mentionedPath) {
    return mentionedPath;
  }

  const quotedPath = prompt.match(/["'“”]([^"'“”]+)["'“”]/)?.[1];
  if (quotedPath) {
    return quotedPath;
  }

  if (isWriteIntent(prompt)) {
    return "ore-code-harness-note.txt";
  }

  return ".";
}

function isReadIntent(prompt: string): boolean {
  return /\b(read|cat|open)\b/i.test(prompt) || /读取|查看|打开/.test(prompt);
}

function isMcpToolIntent(prompt: string): boolean {
  return /\bmcp_[a-zA-Z0-9_]+\b/.test(prompt);
}

function extractMcpToolName(prompt: string): string {
  return prompt.match(/\bmcp_[a-zA-Z0-9_]+\b/)?.[0] ?? "mcp_unknown_tool";
}

function extractMcpToolInput(prompt: string): Record<string, unknown> {
  const fencedJson = prompt.match(/```json\n([\s\S]*?)```/)?.[1]?.trim();
  const inlineJson = prompt.match(/(\{[\s\S]*\})/)?.[1]?.trim();
  const rawJson = fencedJson ?? inlineJson;
  if (!rawJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawJson);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWriteIntent(prompt: string): boolean {
  return /\b(write|create|save)\b/i.test(prompt) || /写入|创建|保存/.test(prompt);
}

function isEditIntent(prompt: string): boolean {
  return /\b(edit|replace)\b/i.test(prompt) || /替换|修改/.test(prompt);
}

function isPatchIntent(prompt: string): boolean {
  return /\b(apply_patch|patch)\b/i.test(prompt) || /应用补丁|打补丁/.test(prompt);
}

function isFileSearchIntent(prompt: string): boolean {
  return /\b(find|search|file_search)\b/i.test(prompt) || /找文件|搜索文件|查找文件/.test(prompt);
}

function isGrepIntent(prompt: string): boolean {
  return /\b(grep|grep_files)\b/i.test(prompt) || /搜索内容|查找内容|搜代码|搜索代码/.test(prompt);
}

function isBackgroundShellIntent(prompt: string): boolean {
  return (
    /\b(background|bg|job)\b/i.test(prompt) ||
    /后台运行|后台执行|长命令|任务运行|放到后台/.test(prompt)
  );
}

function isShellJobStatusIntent(prompt: string): boolean {
  return /\b(shell_job_status|job\s+status|status\s+job)\b/i.test(prompt) || /任务状态|后台状态|查询任务/.test(prompt);
}

function isShellJobOutputIntent(prompt: string): boolean {
  return /\b(shell_job_output|job\s+output|output\s+job)\b/i.test(prompt) || /任务输出|后台输出|查看任务输出/.test(prompt);
}

function isShellIntent(prompt: string): boolean {
  return (
    /\b(run|exec|execute|test|pnpm|npm|yarn|bun|cargo|vitest|pytest|go test)\b/i.test(prompt) ||
    /运行|执行|测试/.test(prompt)
  );
}

function isRunTestsIntent(prompt: string): boolean {
  return (
    /\b(test|vitest|pytest|go test)\b/i.test(prompt) ||
    /\bpnpm\s+(?:--filter\s+\S+\s+)?test(?::[\w-]+)?\b/i.test(prompt) ||
    /\bnpm\s+(?:run\s+)?test\b/i.test(prompt) ||
    /\byarn\s+test\b/i.test(prompt) ||
    /\bbun\s+test\b/i.test(prompt) ||
    /\bcargo\s+test\b/i.test(prompt) ||
    /测试|跑测试|运行测试/.test(prompt)
  );
}

function buildRunTestsInput(prompt: string): Record<string, unknown> {
  const command = extractShellCommand(prompt);
  if (command && command !== "pwd") {
    return { command };
  }

  if (/desktop|桌面/.test(prompt)) {
    return { target: "desktop" };
  }
  if (/agent-core|agent core|核心/.test(prompt)) {
    return { target: "agent-core" };
  }
  if (/\btools\b|工具包/.test(prompt)) {
    return { target: "tools" };
  }
  if (/protocol|协议/.test(prompt)) {
    return { target: "protocol" };
  }
  if (/harness|评测/.test(prompt)) {
    return { target: "harness" };
  }
  if (/tauri|rust|cargo/.test(prompt)) {
    return { target: "tauri" };
  }
  return { target: "auto" };
}

function isGitStatusIntent(prompt: string): boolean {
  return /\b(git\s+status|status)\b/i.test(prompt) || /git状态|变更状态|工作区状态/.test(prompt);
}

function isGitDiffIntent(prompt: string): boolean {
  return /\b(git\s+diff|diff)\b/i.test(prompt) || /查看diff|查看差异|代码差异|变更内容/.test(prompt);
}

function isStructuredReviewIntent(prompt: string): boolean {
  return /\b(structured_review|review|code review|pr review)\b/i.test(prompt) || /结构化评审|代码评审|审查|评审/.test(prompt);
}

function isValidateDataIntent(prompt: string): boolean {
  return (
    /\b(validate_data|validate)\b/i.test(prompt) ||
    /\b(check|verify)\b[\s\S]*\b(json|toml|ya?ml|config)\b/i.test(prompt) ||
    /校验|验证|检查配置|配置格式/.test(prompt)
  );
}

function isCodeExecutionIntent(prompt: string): boolean {
  return /\b(code_execution|python|execute code)\b/i.test(prompt) || /代码执行|执行代码|用Python|统计数据|计算/.test(prompt);
}

function isToolSearchIntent(prompt: string): boolean {
  return /\b(tool_search|search tools?|find tools?)\b/i.test(prompt) || /搜索工具|查找工具|有哪些工具|可用工具/.test(prompt);
}

function isLspIntent(prompt: string): boolean {
  return /\b(lsp_hover|lsp_definition|lsp_references|lsp_document_symbols|hover|definition|references|symbols)\b/i.test(prompt) ||
    /符号|定义|引用|文档符号|代码导航/.test(prompt);
}

function lspToolName(prompt: string) {
  if (/\b(lsp_hover|hover)\b/i.test(prompt) || /悬浮|符号信息/.test(prompt)) return "lsp_hover";
  if (/\b(lsp_references|references)\b/i.test(prompt) || /引用/.test(prompt)) return "lsp_references";
  if (/\b(lsp_document_symbols|symbols)\b/i.test(prompt) || /文档符号|符号列表/.test(prompt)) return "lsp_document_symbols";
  return "lsp_definition";
}

function buildLspInput(prompt: string, path: string): Record<string, unknown> {
  const symbol = extractSymbol(prompt);
  const line = Number(prompt.match(/(?:line|第)\s*(\d+)/i)?.[1] ?? 0) || undefined;
  const column = Number(prompt.match(/(?:column|col|列)\s*(\d+)/i)?.[1] ?? 0) || undefined;
  if (lspToolName(prompt) === "lsp_document_symbols") {
    return { path: path === "." ? "src" : path };
  }
  return {
    ...(path !== "." ? { path } : {}),
    ...(symbol ? { symbol } : {}),
    ...(line ? { line } : {}),
    ...(column ? { column } : {})
  };
}

function extractSymbol(prompt: string) {
  const backticked = prompt.match(/`([^`]+)`/)?.[1]?.trim();
  if (backticked) return backticked;
  return prompt.match(/\b[A-Za-z_$][\w$]{2,}\b/)?.[0];
}

function extractPythonCode(prompt: string) {
  const fenced = prompt.match(/```(?:python|py)?\n([\s\S]*?)```/)?.[1]?.trim();
  if (fenced) return fenced;
  return "print('ok')";
}

function extractToolSearchQuery(prompt: string) {
  const backticked = prompt.match(/`([^`]+)`/)?.[1]?.trim();
  if (backticked) return backticked;
  return prompt.replace(/tool_search|搜索工具|查找工具|有哪些工具|可用工具/gi, "").trim() || "tools";
}

function buildValidateDataInput(prompt: string, path: string): Record<string, unknown> {
  const format = inferDataFormat(prompt, path);
  const input: Record<string, unknown> = { format };
  if (path !== ".") {
    input.path = path;
  } else {
    input.content = extractStructuredContent(prompt, format);
  }
  return input;
}

function inferDataFormat(prompt: string, path: string): "json" | "toml" | "yaml" {
  if (/toml/i.test(prompt) || /\.toml$/i.test(path)) return "toml";
  if (/ya?ml/i.test(prompt) || /\.ya?ml$/i.test(path)) return "yaml";
  return "json";
}

function extractStructuredContent(prompt: string, format: "json" | "toml" | "yaml") {
  const fenced = prompt.match(/```(?:json|toml|ya?ml)?\n([\s\S]*?)```/)?.[1]?.trim();
  if (fenced) {
    return fenced;
  }
  const inlineJson = prompt.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)?.[1]?.trim();
  if (inlineJson && format === "json") {
    return inlineJson;
  }
  return format === "json" ? "{}" : "";
}

function buildStructuredReviewInput(prompt: string, path: string): Record<string, unknown> {
  if (/pr review|PR评审|PR审查/i.test(prompt)) {
    return { scope: "pr" };
  }
  if (/git show|revision|rev|提交/.test(prompt)) {
    return { scope: "revision", rev: extractGitRevision(prompt), ...(path !== "." ? { path } : {}) };
  }
  if (/--staged|--cached|暂存|已暂存/.test(prompt)) {
    return { scope: "staged", staged: true, ...(path !== "." ? { path } : {}) };
  }
  if (path !== ".") {
    return { scope: "file", path };
  }
  return { scope: "workspace" };
}

function isGitBranchIntent(prompt: string): boolean {
  return /\b(git\s+branch|branch)\b/i.test(prompt) || /分支/.test(prompt);
}

function isGitLogIntent(prompt: string): boolean {
  return /\b(git\s+log|log)\b/i.test(prompt) || /提交历史|提交记录/.test(prompt);
}

function isGitShowIntent(prompt: string): boolean {
  return /\b(git\s+show|show)\b/i.test(prompt) || /查看提交|查看revision/.test(prompt);
}

function isGitBlameIntent(prompt: string): boolean {
  return /\b(git\s+blame|blame)\b/i.test(prompt) || /追责|查看作者/.test(prompt);
}

function extractGitRevision(prompt: string): string {
  const backticked = prompt.match(/`([^`]+)`/)?.[1]?.trim();
  if (backticked) {
    return backticked;
  }

  const revision = prompt.match(/\b(?:HEAD~?\d*|[a-f0-9]{7,40})\b/i)?.[0];
  return revision ?? "HEAD";
}

function extractJobId(prompt: string): string {
  const mentioned = prompt.match(/@(job-[\w.-]+|browser-job-[\w.-]+)/i)?.[1];
  if (mentioned) {
    return mentioned;
  }

  const backticked = prompt.match(/`([^`]+)`/)?.[1]?.trim();
  if (backticked) {
    return backticked;
  }

  const jobId = prompt.match(/\b(?:browser-job|job)-[\w.-]+/i)?.[0];
  if (jobId) {
    return jobId;
  }

  return "job-1";
}

function extractShellCommand(prompt: string): string {
  const quotedCommand = prompt.match(/`([^`]+)`/)?.[1];
  if (quotedCommand) {
    return quotedCommand;
  }

  const commandAfterVerb = prompt.match(/(?:运行|执行|测试|run|exec|execute)\s+(.+)/i)?.[1]?.trim();
  if (commandAfterVerb) {
    return commandAfterVerb;
  }

  const commandToken = prompt.match(/\b(pnpm|npm|yarn|bun|cargo|vitest|pytest|go\s+test)\b[\s\S]*/i)?.[0]?.trim();
  if (commandToken) {
    return commandToken;
  }

  return "pwd";
}

function extractEdit(prompt: string): { oldText: string; newText: string } {
  const editableText = prompt.replace(/^.*@\S+\s+/, "");
  const arrow = editableText.match(/["'“”]?([^"'“”=]+?)["'“”]?\s*=>\s*["'“”]?([^"'“”]+)["'“”]?$/);
  if (arrow) {
    return {
      oldText: arrow[1].trim(),
      newText: arrow[2].trim()
    };
  }

  return {
    oldText: "old text",
    newText: "new text"
  };
}

function extractPatch(prompt: string): string {
  const fenced = prompt.match(/```(?:diff|patch)?\n([\s\S]*?)```/)?.[1]?.trim();
  if (fenced) {
    return fenced;
  }

  return [
    "--- a/example.txt",
    "+++ b/example.txt",
    "@@ -1,1 +1,1 @@",
    "-old text",
    "+new text"
  ].join("\n");
}

function extractSearchQuery(prompt: string): string {
  const backticked = prompt.match(/`([^`]+)`/)?.[1]?.trim();
  if (backticked) {
    return backticked;
  }

  const quoted = prompt.match(/["'“”]([^"'“”]+)["'“”]/)?.[1]?.trim();
  if (quoted) {
    return quoted;
  }

  const afterVerb = prompt.match(/(?:找文件|搜索文件|查找文件|搜索内容|查找内容|搜代码|搜索代码|find|search|grep)\s+(.+)/i)?.[1]?.trim();
  if (afterVerb) {
    const cleaned = afterVerb.replace(/^@\S+\s*/, "").trim();
    if (cleaned) {
      return cleaned;
    }
  }

  return "TODO";
}

function buildWriteContent(prompt: string): string {
  // mock 写入固定附带原始输入，便于 harness 回放时确认来源。
  return `Ore Code write probe\n\nPrompt: ${prompt || "empty prompt"}\n`;
}
