import { describe, expect, it } from "vitest";
import {
  createCodingSystemPrompt,
  createDurableTaskSystemPrompt,
  createLegacyCodingSystemPrompt,
  createProjectContextPrompt,
  createSubagentRoleSystemPrompt
} from "./prompts";
import { codingPromptSections } from "./promptSections";

describe("coding prompts", () => {
  it("keeps a stable prompt section pack snapshot", () => {
    expect(codingPromptSections().map((section) => ({ id: section.id, title: section.title }))).toMatchInlineSnapshot(`
      [
        {
          "id": "base_workflow",
          "title": "Base Workflow",
        },
        {
          "id": "tool_selection",
          "title": "Tool Selection",
        },
        {
          "id": "language",
          "title": "Language",
        },
        {
          "id": "runtime_identity",
          "title": "Runtime Identity",
        },
        {
          "id": "deepseek_v4",
          "title": "DeepSeek V4",
        },
        {
          "id": "verification",
          "title": "Verification",
        },
        {
          "id": "parallel_rlm_subagent",
          "title": "Parallel RLM Subagent",
        },
        {
          "id": "subagent_output_contract",
          "title": "Subagent Output Contract",
        },
        {
          "id": "compaction_handoff",
          "title": "Compaction Handoff",
        },
        {
          "id": "mode_overlay",
          "title": "Mode Overlay",
        },
        {
          "id": "plan_interaction",
          "title": "Plan Interaction",
        },
        {
          "id": "durable_task",
          "title": "Durable Task",
        },
        {
          "id": "subagent_role",
          "title": "Subagent Role",
        },
      ]
    `);
  });

  it("instructs visible reasoning to follow the latest user language", () => {
    expect(createCodingSystemPrompt({ workspacePath: "/workspace", mode: "agent" })).toContain(
      "Use the same natural language as the latest user message for visible reasoning/thinking content and final answers"
    );
    expect(createCodingSystemPrompt({ workspacePath: "/workspace", mode: "agent" })).toContain(
      "Project context is not a language signal"
    );
    expect(createLegacyCodingSystemPrompt({ workspacePath: "/workspace", mode: "agent" })).toContain(
      "Use the same natural language as the latest user message for visible reasoning/thinking content and final answers"
    );
  });

  it("includes workflow, verification, RLM, and subagent contract sections", () => {
    const prompt = createCodingSystemPrompt({ workspacePath: "/workspace", mode: "agent" });
    expect(prompt).toContain("Ore Code runtime identity:");
    expect(prompt).toContain("App: Ore Code Desktop.");
    expect(prompt).toContain("Runtime OS:");
    expect(prompt).toContain("Instruction priority:");
    expect(prompt).toContain("For non-trivial tasks, decompose before acting");
    expect(prompt).toContain("Verification principle:");
    expect(prompt).toContain("Use run_tests for test validation when available");
    expect(prompt).toContain("Use structured_review for code review");
    expect(prompt).toContain("Use validate_data after editing JSON, TOML, or YAML files");
    expect(prompt).toContain("Use code_execution for deterministic statistics");
    expect(prompt).toContain("Use install_skill when the user asks to install, create, or save an Ore Code skill");
    expect(prompt).toContain("Use tool_search when you are unsure which tool");
    expect(prompt).toContain("Use MCP through the stable gateway tools");
    expect(prompt).toContain("Use note_list to inspect durable memory indexes");
    expect(prompt).toContain("Skills, memory, and MCP resources are lazy-loaded");
    expect(prompt).toContain("Use lsp_hover, lsp_definition, lsp_references, and lsp_document_symbols");
    expect(prompt).toContain("Use RLM for CHUNK work");
    expect(prompt).toContain("choose role=explorer for read-only discovery, role=worker for a bounded implementation slice, and role=reviewer for evidence-backed review");
    expect(prompt).toContain("Sub-agents default to DeepSeek Flash budget");
    expect(prompt).toContain("Sub-agent output contract:");
    expect(prompt).toContain("Compaction handoff:");
  });

  it("includes a typed-tool-first selection guide", () => {
    const prompt = createCodingSystemPrompt({ workspacePath: "/workspace", mode: "agent" });
    const legacyPrompt = createLegacyCodingSystemPrompt({ workspacePath: "/workspace", mode: "agent" });

    for (const text of [
      "Tool selection guide:",
      "Prefer typed tools over exec_shell",
      "Read files with read_file, not cat/head/tail.",
      "List directories with list_dir, not ls/dir/tree.",
      "Search file contents with grep_files, not rg/grep/findstr.",
      "Search file names with file_search, not find/where/Get-ChildItem.",
      "Inspect Git status, diffs, history, blame, and branches with git_status, git_diff, git_log, git_show, git_blame, and git_branch, not raw git commands.",
      "Run test validation with run_tests before shelling out",
      "Install Ore Code skills with install_skill"
    ]) {
      expect(prompt).toContain(text);
      expect(legacyPrompt).toContain(text);
    }
  });

  it("adds Windows shell guidance when the runtime OS is Windows", () => {
    const prompt = createCodingSystemPrompt({
      workspacePath: "C:\\work\\repo",
      mode: "agent",
      operatingSystem: "windows"
    });
    const context = createProjectContextPrompt({
      workspacePath: "C:\\work\\repo",
      mode: "agent",
      operatingSystem: "windows"
    });

    expect(prompt).toContain("Runtime OS: Windows.");
    expect(prompt).toContain("exec_shell runs through Windows cmd.exe");
    expect(prompt).toContain("do not use POSIX-only commands");
    expect(prompt).toContain("executable shims");
    expect(context).toContain("Runtime OS: Windows.");
  });

  it("adds POSIX shell guidance for macOS and Linux", () => {
    const prompt = createCodingSystemPrompt({
      workspacePath: "/workspace",
      mode: "agent",
      operatingSystem: "macos"
    });

    expect(prompt).toContain("Runtime OS: macOS.");
    expect(prompt).toContain("exec_shell runs through POSIX sh");
    expect(prompt).toContain("Do not use Windows-only cmd.exe or PowerShell syntax");
  });

  it("strengthens the subagent output contract", () => {
    const prompt = createCodingSystemPrompt({ workspacePath: "/workspace", mode: "agent" });
    for (const section of ["SUMMARY", "EVIDENCE", "CHANGES", "RISKS", "BLOCKERS"]) {
      expect(prompt).toContain(section);
    }
    expect(prompt).toContain("EVIDENCE lists only concrete files, commands, tool results, line references, or artifact ids you actually observed");
    expect(prompt).toContain("if you performed no writes, write None");
    expect(prompt).toContain("if none are observed, write None observed");
    expect(prompt).toContain("if nothing blocked you, write None");
    expect(prompt).toContain("After the structured report, stop");
    expect(prompt).toContain("Never claim a file was read, a command was executed, a write was made, or validation passed unless the tool log confirms it");
    expect(prompt).toContain("integrate their SUMMARY, EVIDENCE, CHANGES, RISKS, and BLOCKERS");
    expect(prompt).toContain("Do not repeat a sub-agent's investigation unless its report lacks evidence");
  });

  it("keeps plan mode executable through approval instead of readonly", () => {
    const prompt = createCodingSystemPrompt({ workspacePath: "/workspace", mode: "plan" });
    expect(prompt).toContain("Do not claim plan mode is readonly");
    expect(prompt).toContain("prefer the request_user_input tool");
  });

  it("omits unavailable tool guidance when a concrete tool registry is supplied", () => {
    const prompt = createCodingSystemPrompt({
      workspacePath: "/workspace",
      mode: "agent",
      tools: ["read_file", "list_dir", "grep_files", "git_diff"]
    });

    expect(prompt).toContain("Read files with read_file");
    expect(prompt).toContain("List directories with list_dir");
    expect(prompt).toContain("Search file contents with grep_files");
    expect(prompt).toContain("Inspect Git status, diffs, history");
    expect(prompt).not.toContain("Run test validation with run_tests");
    expect(prompt).not.toContain("Install Ore Code skills with install_skill");
    expect(prompt).not.toContain("Use MCP through the stable gateway tools");
    expect(prompt).not.toContain("Use lsp_hover");
    expect(prompt).not.toContain("Sub-agent output contract:");
  });

  it("covers mode-specific prompt pack overlays", () => {
    const agent = createCodingSystemPrompt({ workspacePath: "/workspace", mode: "agent" });
    const plan = createCodingSystemPrompt({ workspacePath: "/workspace", mode: "plan", tools: ["request_user_input"] });
    const yolo = createCodingSystemPrompt({ workspacePath: "/workspace", mode: "yolo" });
    const windows = createCodingSystemPrompt({
      workspacePath: "C:\\workspace",
      mode: "agent",
      operatingSystem: "windows",
      tools: ["read_file"]
    });
    const readonly = createCodingSystemPrompt({
      workspacePath: "/workspace",
      mode: "agent",
      tools: ["read_file", "list_dir", "grep_files", "git_status", "git_diff"]
    });
    const durable = createDurableTaskSystemPrompt({
      workspacePath: "/workspace",
      mode: "agent",
      tools: ["task_create", "checklist_write"]
    });

    expect(agent).toContain("Mode: agent.");
    expect(agent).not.toContain("Plan mode interaction protocol:");
    expect(plan).toContain("Mode: plan.");
    expect(plan).toContain("Plan mode interaction protocol:");
    expect(yolo).toContain("Mode: yolo.");
    expect(windows).toContain("exec_shell runs through Windows cmd.exe");
    expect(windows).not.toContain("exec_shell runs through POSIX sh");
    expect(readonly).not.toContain("Use edit_file");
    expect(readonly).not.toContain("Run test validation with run_tests");
    expect(durable).toContain("Durable task execution:");
    expect(durable).toContain("Keep the task checklist, gates, and final task state current");
  });

  it("builds subagent role prompts from the same prompt pack", () => {
    const prompt = createSubagentRoleSystemPrompt({ id: "agent-1", role: "reviewer" });

    expect(prompt).toContain("You are running as sub-agent agent-1 (reviewer).");
    expect(prompt).toContain("Role policy: reviewer");
    expect(prompt).toContain("Review only; do not edit files");
  });

  it("keeps plan interaction copy in the user's language", () => {
    expect(createProjectContextPrompt({ workspacePath: "/workspace", mode: "plan" })).toContain(
      "Use the same natural language as the latest user message for the interaction title, message, and option labels"
    );
  });

  it("injects user and project instructions into project context", () => {
    const context = createProjectContextPrompt({
      workspacePath: "/workspace",
      mode: "agent",
      userInstructions: "Prefer concise answers.",
      projectInstructions: "Always run tests before finalizing."
    });

    expect(context).toContain("Loaded instructions:");
    expect(context).toContain("<project_instructions source=\".ore-code/instructions.md\">");
    expect(context).toContain("Always run tests before finalizing.");
    expect(context).toContain("<user_global_instructions source=\"~/.ore-code/instructions.md\">");
    expect(context).toContain("Prefer concise answers.");
  });

  it("adds only lazy context indexes to project context", () => {
    const context = createProjectContextPrompt({
      workspacePath: "/workspace",
      mode: "agent",
      lazyContextIndex: "Skills:\n- /reviewer: Reviewer"
    });

    expect(context).toContain("<lazy_context_index>");
    expect(context).toContain("/reviewer: Reviewer");
    expect(context).toContain("Full skill, memory, MCP resource, and MCP prompt bodies are loaded on demand");
  });
});
