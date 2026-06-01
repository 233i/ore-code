import { describe, expect, it } from "vitest";
import type { ToolCardState } from "../features/tools/toolCards";
import { deriveRlmProgressForToolCard } from "../features/tools/rlmProgress";
import { getToolHumanSummary, toolPresentationFor, toolPresentationRegistry } from "../features/tools/toolPresentation";

describe("deriveRlmProgressForToolCard", () => {
  it("derives running and completed RLM subtask progress from command output", () => {
    const card: ToolCardState = {
      id: "turn:rlm-1",
      turnId: "turn",
      callId: "rlm-1",
      name: "rlm_query",
      status: "running",
      input: { prompts: ["first", "second"] },
      commandOutput: {
        stdout: [
          JSON.stringify({ type: "rlm_progress", status: "running", index: 0, total: 2, promptPreview: "first" }),
          JSON.stringify({ type: "rlm_progress", status: "completed", index: 0, total: 2, promptPreview: "first", durationMs: 25 }),
          JSON.stringify({ type: "rlm_progress", status: "running", index: 1, total: 2, promptPreview: "second" })
        ].join("\n"),
        stderr: "",
        truncated: false
      }
    };

    expect(deriveRlmProgressForToolCard(card)).toMatchObject({
      total: 2,
      completed: 1,
      running: 1,
      failed: 0,
      items: [
        { index: 0, status: "completed", promptPreview: "first", durationMs: 25 },
        { index: 1, status: "running", promptPreview: "second" }
      ]
    });
  });

  it("derives final RLM progress from completed tool output", () => {
    const card: ToolCardState = {
      id: "turn:rlm-1",
      turnId: "turn",
      callId: "rlm-1",
      name: "rlm_query",
      status: "completed",
      input: { prompts: ["first", "second"] },
      result: {
        callId: "rlm-1",
        ok: true,
        output: {
          promptCount: 2,
          results: [
            { index: 0, ok: true, promptPreview: "first", durationMs: 20 },
            { index: 1, ok: false, promptPreview: "second", durationMs: 30, error: "child failed" }
          ]
        }
      }
    };

    expect(deriveRlmProgressForToolCard(card)).toMatchObject({
      total: 2,
      completed: 1,
      failed: 1,
      items: [
        { index: 0, status: "completed", promptPreview: "first" },
        { index: 1, status: "failed", promptPreview: "second", error: "child failed" }
      ]
    });
  });
});

describe("getToolHumanSummary", () => {
  it("summarizes shell calls without exposing raw payload data", () => {
    expect(getToolHumanSummary({
      id: "turn:shell-1",
      turnId: "turn",
      callId: "shell-1",
      name: "exec_shell",
      status: "running",
      input: { command: "mkdir -p /tmp/admin_dashboard" }
    })).toBe("正在执行命令：mkdir -p /tmp/admin_dashboard");
  });

  it("summarizes completed file writes as a concise action", () => {
    expect(getToolHumanSummary({
      id: "turn:write-1",
      turnId: "turn",
      callId: "write-1",
      name: "write_file",
      status: "completed",
      input: { path: "/tmp/admin_dashboard/index.html" },
      result: {
        callId: "write-1",
        ok: true,
        output: { path: "/tmp/admin_dashboard/index.html", bytesWritten: 11095 }
      }
    })).toBe("已写入文件：/tmp/admin_dashboard/index.html（11095 字节）");
  });

  it("summarizes completed directory listing without dumping entries", () => {
    expect(getToolHumanSummary({
      id: "turn:list-1",
      turnId: "turn",
      callId: "list-1",
      name: "list_dir",
      status: "completed",
      input: { path: "/tmp/admin_dashboard" },
      result: {
        callId: "list-1",
        ok: true,
        output: {
          entries: [
            { name: "index.html", path: "/tmp/admin_dashboard/index.html", isDir: false, size: 11095 }
          ]
        }
      }
    })).toBe("已列出目录：/tmp/admin_dashboard（1 项）");
  });

  it("summarizes test runs as tests instead of raw shell payloads", () => {
    expect(getToolHumanSummary({
      id: "turn:test-1",
      turnId: "turn",
      callId: "test-1",
      name: "run_tests",
      status: "completed",
      input: { target: "agent-core" },
      result: {
        callId: "test-1",
        ok: true,
        output: {
          target: "agent-core",
          command: "pnpm --filter @ore-code/agent-core test",
          passed: true,
          exitCode: 0,
          durationMs: 120,
          timedOut: false
        }
      }
    })).toBe("测试通过：pnpm --filter @ore-code/agent-core test（120ms）");
  });

  it("summarizes subagent role, model, and concurrency without dumping payloads", () => {
    expect(getToolHumanSummary({
      id: "turn:agent-1",
      turnId: "turn",
      callId: "agent-1",
      name: "agent_spawn",
      status: "completed",
      input: { prompt: "review auth", role: "reviewer" },
      result: {
        callId: "agent-1",
        ok: true,
        output: {
          id: "agent-1",
          name: "auth-review",
          role: "reviewer",
          status: "running",
          model: "deepseek-v4-flash",
          activeCount: 1,
          maxConcurrent: 4
        }
      }
    })).toBe("已启动子智能体：auth-review（运行中 · 评审 · deepseek-v4-flash · 并发 1/4）");
  });

  it("summarizes task and checklist tools without dumping task JSON", () => {
    expect(getToolHumanSummary({
      id: "turn:task-1",
      turnId: "turn",
      callId: "task-1",
      name: "task_create",
      status: "completed",
      input: { title: "Implement UI" },
      result: {
        callId: "task-1",
        ok: true,
        output: {
          id: "task-1",
          title: "Implement UI",
          status: "running",
          checklist: []
        }
      }
    })).toBe("已创建任务：Implement UI（运行中）");

    expect(getToolHumanSummary({
      id: "turn:checklist-1",
      turnId: "turn",
      callId: "checklist-1",
      name: "checklist_write",
      status: "completed",
      input: {},
      result: {
        callId: "checklist-1",
        ok: true,
        output: {
          id: "task-1",
          title: "Implement UI",
          checklist: [
            { id: 1, content: "Patch UI", status: "completed" },
            { id: 2, content: "Run tests", status: "pending" }
          ]
        }
      }
    })).toBe("已更新清单：1/2 完成");

    expect(getToolHumanSummary({
      id: "turn:checklist-2",
      turnId: "turn",
      callId: "checklist-2",
      name: "checklist_update",
      status: "completed",
      input: {},
      result: {
        callId: "checklist-2",
        ok: true,
        output: {
          item: { id: 2, content: "Run tests", status: "in_progress" }
        }
      }
    })).toBe("已更新清单项：Run tests（进行中）");
  });

  it("summarizes task gates and artifacts", () => {
    expect(getToolHumanSummary({
      id: "turn:gate-1",
      turnId: "turn",
      callId: "gate-1",
      name: "task_gate_run",
      status: "completed",
      input: { command: "pnpm test" },
      result: {
        callId: "gate-1",
        ok: true,
        output: {
          gate: { name: "pnpm test", status: "passed", durationMs: 42 }
        }
      }
    })).toBe("已执行验证：pnpm test（通过 · 42ms）");

    expect(getToolHumanSummary({
      id: "turn:artifact-1",
      turnId: "turn",
      callId: "artifact-1",
      name: "task_artifact_record",
      status: "completed",
      input: { summary: "Patch artifact" },
      result: {
        callId: "artifact-1",
        ok: true,
        output: {
          artifact: { artifactId: "artifact-1", summary: "Patch artifact" }
        }
      }
    })).toBe("已记录产物：Patch artifact");
  });

  it("summarizes structured reviews without dumping findings", () => {
    expect(getToolHumanSummary({
      id: "turn:review-1",
      turnId: "turn",
      callId: "review-1",
      name: "structured_review",
      status: "completed",
      input: { scope: "workspace" },
      result: {
        callId: "review-1",
        ok: true,
        output: {
          scope: "workspace",
          source: "workspace diff",
          findingCounts: { critical: 1, warning: 2, info: 3 }
        }
      }
    })).toBe("评审完成：workspace diff（1 严重 / 2 警告 / 3 提示）");
  });

  it("summarizes data validation results", () => {
    expect(getToolHumanSummary({
      id: "turn:validate-1",
      turnId: "turn",
      callId: "validate-1",
      name: "validate_data",
      status: "completed",
      input: { path: "package.json" },
      result: {
        callId: "validate-1",
        ok: true,
        output: {
          valid: false,
          format: "json",
          path: "package.json",
          errors: [{ message: "Unexpected token" }]
        }
      }
    })).toBe("数据校验失败：package.json（json，1 个错误）");
  });

  it("summarizes code execution results", () => {
    expect(getToolHumanSummary({
      id: "turn:code-1",
      turnId: "turn",
      callId: "code-1",
      name: "code_execution",
      status: "completed",
      input: { language: "python", code: "print(1)" },
      result: {
        callId: "code-1",
        ok: true,
        output: { passed: true, durationMs: 10, stdout: "1\n", stderr: "" }
      }
    })).toBe("代码执行完成（10ms）");
  });

  it("summarizes tool search and LSP results", () => {
    expect(getToolHumanSummary({
      id: "turn:search-1",
      turnId: "turn",
      callId: "search-1",
      name: "tool_search",
      status: "completed",
      input: { query: "test" },
      result: {
        callId: "search-1",
        ok: true,
        output: { query: "test", results: [{ name: "run_tests" }] }
      }
    })).toBe("工具搜索完成：test（1 项）");

    expect(getToolHumanSummary({
      id: "turn:lsp-1",
      turnId: "turn",
      callId: "lsp-1",
      name: "lsp_definition",
      status: "completed",
      input: { symbol: "run" },
      result: {
        callId: "lsp-1",
        ok: true,
        output: { symbol: "run", locations: [{ path: "src/app.ts", line: 1 }] }
      }
    })).toBe("查找定义完成：run（1 处）");
  });
});

describe("toolPresentationRegistry", () => {
  it("keeps compact payload policies and core labels in the registry", () => {
    expect(toolPresentationRegistry.exec_shell).toMatchObject({
      label: "执行命令",
      payloadPolicy: "compact"
    });
    expect(toolPresentationRegistry.run_tests).toMatchObject({
      label: "运行测试",
      payloadPolicy: "compact"
    });
  });

  it("falls back cleanly for unknown tools", () => {
    expect(toolPresentationFor("unknown_tool")).toBeUndefined();
  });
});
