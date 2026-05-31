import {
  defaultSandboxPolicy,
  processCommandString,
  type ProcessRunOutput,
  type ProcessToolHost
} from "@seekforge/tools";
import type { DoctorCategory, DoctorCheck, WorkspaceSignals } from "./workspaceDoctor";

export type EnvironmentInstallPlatform = "windows" | "macos" | "linux" | "unknown";
export type EnvironmentInstallRisk = "low" | "medium" | "high";
export type EnvironmentInstallStepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface EnvironmentInstallCommand {
  program: string;
  args: string[];
  workspacePath: string;
  timeoutMs: number;
}

export interface EnvironmentInstallStep {
  id: string;
  title: string;
  description: string;
  category: DoctorCategory;
  risk: EnvironmentInstallRisk;
  command?: EnvironmentInstallCommand;
  manualHint?: string;
}

export interface EnvironmentInstallPlan {
  generatedAt: string;
  platform: EnvironmentInstallPlatform;
  workspacePath: string;
  steps: EnvironmentInstallStep[];
  executableStepCount: number;
  message: string;
}

export interface EnvironmentInstallStepResult {
  stepId: string;
  status: EnvironmentInstallStepStatus;
  ok: boolean;
  skipped: boolean;
  title: string;
  command?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number | null;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface EnvironmentInstallResult {
  ok: boolean;
  results: EnvironmentInstallStepResult[];
}

export type EnvironmentInstallStepCallback = (result: EnvironmentInstallStepResult) => void;

export function detectEnvironmentInstallPlatform(): EnvironmentInstallPlatform {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const platform = [
    nav && "userAgentData" in nav ? (nav.userAgentData as { platform?: string }).platform : undefined,
    nav?.platform,
    nav?.userAgent
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  if (platform.includes("linux")) return "linux";
  return "unknown";
}

export function buildEnvironmentInstallPlan(
  checks: DoctorCheck[],
  platform: EnvironmentInstallPlatform,
  workspaceSignals: WorkspaceSignals | null | undefined,
  workspacePath: string
): EnvironmentInstallPlan {
  const steps: EnvironmentInstallStep[] = [];
  const checkById = new Map(checks.map((check) => [check.id, check]));

  addToolchainStep(steps, platform, checkById.get("command:git"), {
    id: "install:git",
    title: "安装 Git",
    description: "用于代码变更、diff、提交、分支和仓库状态能力。",
    windows: command(workspacePath, "winget", [
      "install",
      "--id",
      "Git.Git",
      "-e",
      "--accept-source-agreements",
      "--accept-package-agreements"
    ]),
    macos: command(workspacePath, "brew", ["install", "git"]),
    linux: "请使用系统包管理器安装 Git，例如 apt、dnf、pacman 或发行版软件中心。"
  });

  addToolchainStep(steps, platform, checkById.get("command:node"), {
    id: "install:node",
    title: "安装 Node.js LTS",
    description: "用于前端项目、MCP npm 包、npm/npx/pnpm 能力。",
    windows: command(workspacePath, "winget", [
      "install",
      "--id",
      "OpenJS.NodeJS.LTS",
      "-e",
      "--accept-source-agreements",
      "--accept-package-agreements"
    ]),
    macos: command(workspacePath, "brew", ["install", "node"]),
    linux: "请按发行版或 NodeSource/nvm 文档安装 Node.js LTS。"
  });

  addToolchainStep(steps, platform, checkById.get("command:pnpm"), {
    id: "enable:pnpm",
    title: "启用 pnpm",
    description: "使用 Node.js 自带的 corepack 启用 pnpm shim，适合 pnpm-lock.yaml 项目。",
    windows: command(workspacePath, "corepack", ["enable", "pnpm"]),
    macos: command(workspacePath, "corepack", ["enable", "pnpm"]),
    linux: "安装 Node.js 后运行 corepack enable pnpm，或按项目约定安装 pnpm。"
  });

  addToolchainStep(steps, platform, checkById.get("command:python"), {
    id: "install:python",
    title: "安装 Python",
    description: "用于 Python 项目、code_execution 和部分语言诊断能力。",
    windows: command(workspacePath, "winget", [
      "install",
      "--id",
      "Python.Python.3.12",
      "-e",
      "--accept-source-agreements",
      "--accept-package-agreements"
    ]),
    macos: command(workspacePath, "brew", ["install", "python"]),
    linux: "请使用系统包管理器安装 Python 3，并按项目约定创建虚拟环境。"
  });

  addCargoStep(steps, checkById.get("command:cargo"));
  addProjectDependencySteps(steps, workspaceSignals, workspacePath);

  const executableStepCount = steps.filter((step) => step.command).length;
  return {
    generatedAt: new Date().toISOString(),
    platform,
    workspacePath,
    steps,
    executableStepCount,
    message:
      steps.length === 0
        ? "当前未发现需要修复的环境项。"
        : `发现 ${steps.length} 个可处理项，其中 ${executableStepCount} 个可确认后执行。`
  };
}

export async function runEnvironmentInstallPlan(
  plan: EnvironmentInstallPlan,
  processHost: ProcessToolHost,
  onStepResult?: EnvironmentInstallStepCallback
): Promise<EnvironmentInstallResult> {
  const results: EnvironmentInstallStepResult[] = [];

  for (const step of plan.steps) {
    if (!step.command) {
      const result: EnvironmentInstallStepResult = {
        stepId: step.id,
        title: step.title,
        status: "skipped",
        ok: false,
        skipped: true,
        error: step.manualHint ?? "需要手动处理。"
      };
      results.push(result);
      onStepResult?.(result);
      continue;
    }

    try {
      const output = await processHost.run({
        workspacePath: step.command.workspacePath,
        program: step.command.program,
        args: step.command.args,
        timeoutMs: step.command.timeoutMs,
        sandboxPolicy: defaultSandboxPolicy({
          allowNetwork: true,
          allowReadOutsideWorkspace: false,
          allowWriteWorkspace: true
        })
      });
      const result = outputToStepResult(step, output);
      results.push(result);
      onStepResult?.(result);
    } catch (error) {
      const result: EnvironmentInstallStepResult = {
        stepId: step.id,
        title: step.title,
        status: "failed",
        ok: false,
        skipped: false,
        command: commandToString(step.command),
        error: error instanceof Error ? error.message : String(error)
      };
      results.push(result);
      onStepResult?.(result);
    }
  }

  return {
    ok: results.every((result) => result.ok),
    results
  };
}

function addToolchainStep(
  steps: EnvironmentInstallStep[],
  platform: EnvironmentInstallPlatform,
  check: DoctorCheck | undefined,
  options: {
    id: string;
    title: string;
    description: string;
    windows: EnvironmentInstallCommand;
    macos: EnvironmentInstallCommand;
    linux: string;
  }
) {
  if (!isMissingRepairable(check)) {
    return;
  }

  if (platform === "windows") {
    steps.push(toolchainStep(options.id, options.title, options.description, options.windows));
    return;
  }
  if (platform === "macos") {
    steps.push(toolchainStep(options.id, options.title, options.description, options.macos));
    return;
  }

  steps.push({
    id: options.id,
    title: options.title,
    description: `${options.description} ${options.linux}`,
    category: "toolchain",
    risk: "medium",
    manualHint: options.linux
  });
}

function addCargoStep(steps: EnvironmentInstallStep[], check: DoctorCheck | undefined) {
  if (!isMissingRepairable(check)) {
    return;
  }
  steps.push({
    id: "install:rust",
    title: "安装 Rust/Cargo",
    description: "Cargo 建议通过 rustup 安装；为避免执行远程 shell，本步骤只提供手动提示。",
    category: "toolchain",
    risk: "medium",
    manualHint: "请从 https://rustup.rs 安装 Rust toolchain，完成后重新运行环境检测。"
  });
}

function addProjectDependencySteps(
  steps: EnvironmentInstallStep[],
  workspaceSignals: WorkspaceSignals | null | undefined,
  workspacePath: string
) {
  if (!workspaceSignals) return;

  if (workspaceSignals.hasPackageJson) {
    const manager = workspaceSignals.packageManager ?? "npm";
    steps.push({
      id: `project:${manager}:install`,
      title: `安装项目依赖 (${manager})`,
      description: "在当前 workspace 下安装 package.json 依赖。会联网并写入依赖目录或 lockfile，执行前必须确认。",
      category: "project",
      risk: "high",
      command: command(workspacePath, manager, ["install"], 300_000)
    });
  }

  if (workspaceSignals.hasCargoToml) {
    steps.push({
      id: "project:cargo:fetch",
      title: "获取 Rust 项目依赖",
      description: "在当前 workspace 下运行 cargo fetch，预取 Cargo 依赖。会联网并写入 Cargo 缓存。",
      category: "project",
      risk: "medium",
      command: command(workspacePath, "cargo", ["fetch"], 300_000)
    });
  }

  if (workspaceSignals.hasPyprojectToml || workspaceSignals.hasRequirementsTxt) {
    steps.push({
      id: "project:python:manual",
      title: "处理 Python 项目依赖",
      description: "检测到 Python 项目文件。第一版不自动创建虚拟环境或 pip install，避免污染项目。",
      category: "project",
      risk: "medium",
      manualHint: "请按项目 README 或团队规范创建虚拟环境后安装依赖。"
    });
  }
}

function isMissingRepairable(check: DoctorCheck | undefined) {
  return Boolean(check && check.repairable && check.status !== "pass");
}

function toolchainStep(
  id: string,
  title: string,
  description: string,
  commandInput: EnvironmentInstallCommand
): EnvironmentInstallStep {
  return {
    id,
    title,
    description,
    category: "toolchain",
    risk: "medium",
    command: commandInput
  };
}

function command(workspacePath: string, program: string, args: string[], timeoutMs = 300_000): EnvironmentInstallCommand {
  return {
    program,
    args,
    workspacePath,
    timeoutMs
  };
}

function outputToStepResult(step: EnvironmentInstallStep, output: ProcessRunOutput): EnvironmentInstallStepResult {
  return {
    stepId: step.id,
    title: step.title,
    status: output.exitCode === 0 ? "succeeded" : "failed",
    ok: output.exitCode === 0,
    skipped: false,
    command: commandToString(step.command),
    exitCode: output.exitCode,
    timedOut: output.timedOut,
    durationMs: output.durationMs,
    stdout: output.stdout,
    stderr: output.stderr,
    error: output.exitCode === 0 ? undefined : output.stderr || `命令退出码 ${output.exitCode ?? "unknown"}`
  };
}

function commandToString(commandInput: EnvironmentInstallCommand | undefined) {
  if (!commandInput) return undefined;
  return processCommandString(commandInput.program, commandInput.args);
}
