import { describe, expect, it } from "vitest";
import { planMockTurn } from "./mockTurnPlanner";

describe("planMockTurn", () => {
  it("lists the current directory by default", () => {
    const chunks = planMockTurn("列出当前工作区");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "list_dir", input: { path: "." } }
    });
  });

  it("uses @path context for read requests", () => {
    const chunks = planMockTurn("读取 @package.json");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "read_file", input: { path: "package.json" } }
    });
  });

  it("routes write requests through write_file", () => {
    const chunks = planMockTurn("写入 @notes.txt");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "write_file", input: { path: "notes.txt" } }
    });
  });

  it("routes test requests through run_tests", () => {
    const chunks = planMockTurn("运行 pnpm test");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "run_tests", input: { command: "pnpm test" } }
    });
  });

  it("routes non-test shell requests through exec_shell", () => {
    const chunks = planMockTurn("运行 pwd");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "exec_shell", input: { command: "pwd" } }
    });
  });

  it("routes explicit MCP tool requests through the gateway", () => {
    const chunks = planMockTurn('调用 mcp_docs_search {"query":"tauri"}');

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "mcp_call_tool", input: { qualifiedName: "mcp_docs_search", arguments: { query: "tauri" } } }
    });
  });

  it("routes background shell requests through start_shell_job", () => {
    const chunks = planMockTurn("后台运行 pnpm test");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "start_shell_job", input: { command: "pnpm test", timeoutMs: 300_000 } }
    });
  });

  it("routes job status requests through shell_job_status", () => {
    const chunks = planMockTurn("查询任务状态 job-123");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "shell_job_status", input: { jobId: "job-123" } }
    });
  });

  it("routes job output requests through shell_job_output", () => {
    const chunks = planMockTurn("查看任务输出 `job-123`");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "shell_job_output", input: { jobId: "job-123" } }
    });
  });

  it("routes git status requests through git_status", () => {
    const chunks = planMockTurn("git status");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "git_status", input: {} }
    });
  });

  it("routes git diff requests through git_diff", () => {
    const chunks = planMockTurn("查看 diff --staged");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "git_diff", input: { staged: true } }
    });
  });

  it("passes @path context to git_diff", () => {
    const chunks = planMockTurn("查看 diff @src/app.ts");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "git_diff", input: { staged: false, path: "src/app.ts" } }
    });
  });

  it("routes git review requests through structured git tools", () => {
    expect(planMockTurn("git branch")[1]).toMatchObject({
      type: "tool_call",
      call: { name: "git_branch", input: {} }
    });
    expect(planMockTurn("git log")[1]).toMatchObject({
      type: "tool_call",
      call: { name: "git_log", input: { maxCount: 20 } }
    });
    expect(planMockTurn("git show HEAD @src/app.ts")[1]).toMatchObject({
      type: "tool_call",
      call: { name: "git_show", input: { rev: "HEAD", path: "src/app.ts" } }
    });
    expect(planMockTurn("git blame @src/app.ts")[1]).toMatchObject({
      type: "tool_call",
      call: { name: "git_blame", input: { path: "src/app.ts" } }
    });
  });

  it("routes code review requests through structured_review", () => {
    const chunks = planMockTurn("审查当前变更 @src/app.ts");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "structured_review", input: { scope: "file", path: "src/app.ts" } }
    });
  });

  it("routes data validation requests through validate_data", () => {
    const chunks = planMockTurn("校验 @package.json");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "validate_data", input: { format: "json", path: "package.json" } }
    });
  });

  it("routes tool capability requests through tool_search", () => {
    const chunks = planMockTurn("搜索工具 `python`");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "tool_search", input: { query: "python" } }
    });
  });

  it("routes code execution requests through code_execution", () => {
    const chunks = planMockTurn(["执行代码", "```python", "print(1 + 1)", "```"].join("\n"));

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "code_execution", input: { language: "python", code: "print(1 + 1)" } }
    });
  });

  it("routes LSP navigation requests through LSP tools", () => {
    const chunks = planMockTurn("查找定义 @src/app.ts `run`");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "lsp_definition", input: { path: "src/app.ts", symbol: "run" } }
    });
  });

  it("routes file search requests through file_search", () => {
    const chunks = planMockTurn("找文件 @src app");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "file_search", input: { path: "src", query: "app" } }
    });
  });

  it("routes content search requests through grep_files", () => {
    const chunks = planMockTurn("搜索内容 @src `TODO`");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "grep_files", input: { path: "src", pattern: "TODO", caseSensitive: false } }
    });
  });

  it("uses a fallback search query when only a path is provided", () => {
    const chunks = planMockTurn("搜索内容 @src");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "grep_files", input: { path: "src", pattern: "TODO" } }
    });
  });

  it("routes edit requests through edit_file", () => {
    const chunks = planMockTurn("替换 @src/app.ts foo=>bar");

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "edit_file", input: { path: "src/app.ts", oldText: "foo", newText: "bar" } }
    });
  });

  it("routes patch requests through apply_patch", () => {
    const chunks = planMockTurn(["应用补丁", "```diff", "--- a/a.txt", "+++ b/a.txt", "@@ -1 +1 @@", "-a", "+b", "```"].join("\n"));

    expect(chunks[1]).toMatchObject({
      type: "tool_call",
      call: { name: "apply_patch", input: { patch: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b" } }
    });
  });
});
