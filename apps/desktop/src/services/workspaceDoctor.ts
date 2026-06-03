import type { FileToolHost, ProcessToolHost, ShellToolHost } from "@ore-code/tools";
import type { ProviderSecretStatus } from "./providerSecrets";

export type DoctorStatus = "pass" | "warn" | "fail" | "info";
export type DoctorCategory = "core" | "toolchain" | "project" | "provider";
export type DoctorRequiredLevel = "required" | "recommended" | "optional";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  category?: DoctorCategory;
  requiredLevel?: DoctorRequiredLevel;
  repairable?: boolean;
  detectedVersion?: string;
  installHint?: string;
}

export interface EnvironmentPaths {
  appDataPath?: string;
  userHomePath?: string;
}

export type ProjectPackageManager = "pnpm" | "npm" | "yarn" | "bun";

export interface WorkspaceSignals {
  hasPackageJson: boolean;
  packageManager?: ProjectPackageManager;
  hasCargoToml: boolean;
  hasPyprojectToml: boolean;
  hasRequirementsTxt: boolean;
}

export interface EnvironmentDoctorInput {
  workspacePath: string;
  provider: string;
  providerLabel?: string;
  secretStatus: ProviderSecretStatus | null;
  processHost: ProcessToolHost;
  shellHost: ShellToolHost;
  fileHost?: FileToolHost;
  environmentPaths?: EnvironmentPaths;
  workspaceSignals?: WorkspaceSignals;
  configSources?: Array<{ scope: string; path: string; status: string; error?: string }>;
}

export type WorkspaceDoctorInput = EnvironmentDoctorInput;

export async function runEnvironmentDoctor(input: EnvironmentDoctorInput): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const workspaceSignals = input.workspaceSignals ?? (input.fileHost ? await detectWorkspaceSignals(input.fileHost, input.workspacePath) : undefined);

  checks.push(...checkCoreEnvironment(input.environmentPaths));
  checks.push(await checkShell(input.shellHost, input.workspacePath));
  checks.push(
    await checkCommand(input.processHost, input.workspacePath, {
      commandName: "git",
      label: "Git CLI",
      missingStatus: "warn",
      requiredLevel: "recommended",
      installHint: "安装 Git 后可启用 diff、提交、分支和仓库状态能力。"
    })
  );
  checks.push(
    await checkCommand(input.processHost, input.workspacePath, {
      commandName: "node",
      label: "Node.js runtime",
      missingStatus: "warn",
      requiredLevel: "recommended",
      installHint: "安装 Node.js LTS 后可运行前端项目、MCP npm 包和 pnpm/npm 工具。"
    })
  );
  checks.push(
    await checkCommand(input.processHost, input.workspacePath, {
      commandName: "npm",
      label: "npm package manager",
      missingStatus: "info",
      requiredLevel: "optional",
      installHint: "npm 通常随 Node.js 一起安装。"
    })
  );
  checks.push(
    await checkCommand(input.processHost, input.workspacePath, {
      commandName: "pnpm",
      label: "pnpm package manager",
      missingStatus: "info",
      requiredLevel: workspaceSignals?.packageManager === "pnpm" ? "recommended" : "optional",
      installHint: "可通过 corepack 启用 pnpm，用于 pnpm-lock.yaml 项目。"
    })
  );
  checks.push(
    await checkCommand(input.processHost, input.workspacePath, {
      commandName: "cargo",
      label: "Rust/Cargo toolchain",
      missingStatus: "info",
      requiredLevel: workspaceSignals?.hasCargoToml ? "recommended" : "optional",
      installHint: "安装 Rust toolchain 后可运行 Cargo 项目、Tauri 构建和 Rust 检查。"
    })
  );
  checks.push(await checkPython(input.processHost, input.workspacePath, workspaceSignals));
  checks.push(
    await checkCommand(input.processHost, input.workspacePath, {
      commandName: "npx",
      label: "npx package runner",
      missingStatus: "info",
      requiredLevel: "optional",
      installHint: "npx 通常随 npm 一起安装，用于临时运行 npm 包和部分 MCP server。"
    })
  );
  checks.push(checkConfig(input.configSources ?? []));
  checks.push(checkProvider(input.provider, input.secretStatus));
  checks.push(...checkProjectSignals(workspaceSignals));

  return checks;
}

export const runWorkspaceDoctor = runEnvironmentDoctor;

export function summarizeDoctor(checks: DoctorCheck[]) {
  const fail = checks.filter((check) => check.status === "fail").length;
  const warn = checks.filter((check) => check.status === "warn").length;
  const pass = checks.filter((check) => check.status === "pass").length;

  if (fail > 0) {
    return `${fail} failed, ${warn} warnings, ${pass} passed`;
  }

  if (warn > 0) {
    return `${warn} warnings, ${pass} passed`;
  }

  return `${pass} checks passed`;
}

async function checkShell(shellHost: ShellToolHost, workspacePath: string): Promise<DoctorCheck> {
  try {
    const result = await shellHost.run({ workspacePath, command: "echo ore-code-shell-ok", timeoutMs: 5_000 });
    if (result.exitCode !== 0) {
      return {
        id: "shell",
        label: "Shell execution",
        status: "fail",
        detail: result.stderr || `pwd exited with ${result.exitCode}`,
        category: "toolchain",
        requiredLevel: "required",
        repairable: false,
        installHint: "自由 shell 工具不可用，请检查当前桌面运行环境。"
      };
    }

    return {
      id: "shell",
      label: "Shell execution",
      status: "pass",
      detail: result.stdout.trim() || "shell command completed",
      category: "toolchain",
      requiredLevel: "required",
      repairable: false
    };
  } catch (error) {
    return failure("shell", "Shell execution", error, "fail", {
      category: "toolchain",
      requiredLevel: "required",
      repairable: false,
      installHint: "自由 shell 工具不可用，请检查当前桌面运行环境。"
    });
  }
}

type CommandCheckOptions = {
  commandName: string;
  label: string;
  missingStatus?: DoctorStatus;
  requiredLevel?: DoctorRequiredLevel;
  installHint?: string;
};

async function checkCommand(processHost: ProcessToolHost, workspacePath: string, options: CommandCheckOptions): Promise<DoctorCheck> {
  const { commandName, label, missingStatus = "fail", requiredLevel = "recommended", installHint } = options;
  try {
    const result = await processHost.run({
      workspacePath,
      program: commandName,
      args: ["--version"],
      timeoutMs: 8_000
    });

    if (result.exitCode !== 0) {
      return {
        id: `command:${commandName}`,
        label,
        status: missingStatus,
        detail: result.stderr || `${commandName} was not found on PATH`,
        category: "toolchain",
        requiredLevel,
        repairable: true,
        installHint
      };
    }

    const detectedVersion = firstNonEmptyLine(result.stdout) || firstNonEmptyLine(result.stderr);
    return {
      id: `command:${commandName}`,
      label,
      status: "pass",
      detail: detectedVersion || `${commandName} is available`,
      category: "toolchain",
      requiredLevel,
      repairable: false,
      detectedVersion
    };
  } catch (error) {
    return failure(`command:${commandName}`, label, error, missingStatus, {
      category: "toolchain",
      requiredLevel,
      repairable: true,
      installHint
    });
  }
}

function checkProvider(provider: EnvironmentDoctorInput["provider"], secretStatus: ProviderSecretStatus | null): DoctorCheck {
  if (provider === "mock") {
    return {
      id: "provider",
      label: "Model provider",
      status: "info",
      detail: "当前使用 Mock Harness，不会调用真实模型。",
      category: "provider",
      requiredLevel: "optional",
      repairable: false
    };
  }

  if (secretStatus?.hasSecret) {
    return {
      id: "provider",
      label: "Model provider",
      status: "pass",
      detail: `API Key 已保存${secretStatus.last4 ? `，尾号 ${secretStatus.last4}` : ""}。`,
      category: "provider",
      requiredLevel: "recommended",
      repairable: false
    };
  }

  return {
    id: "provider",
    label: "Model provider",
    status: "warn",
    detail:
      secretStatus?.source === "unsupported"
        ? "当前运行环境不支持系统安全存储。"
        : `尚未保存 ${provider} API Key。`,
    category: "provider",
    requiredLevel: "recommended",
    repairable: false,
    installHint: "在模型与密钥设置中保存 API Key。"
  };
}

function checkConfig(sources: NonNullable<EnvironmentDoctorInput["configSources"]>): DoctorCheck {
  const errors = sources.filter((source) => source.status === "error");
  if (errors.length > 0) {
    return {
      id: "config",
      label: "Ore Code config",
      status: "fail",
      detail: errors.map((source) => `${source.scope}: ${source.error ?? source.path}`).join("; "),
      category: "core",
      requiredLevel: "recommended",
      repairable: false
    };
  }

  const loaded = sources.filter((source) => source.status === "loaded");
  if (loaded.length > 0) {
    return {
      id: "config",
      label: "Ore Code config",
      status: "pass",
      detail: loaded.map((source) => `${source.scope}: ${source.path}`).join("; "),
      category: "core",
      requiredLevel: "recommended",
      repairable: false
    };
  }

  return {
    id: "config",
    label: "Ore Code config",
    status: "info",
    detail: "未发现 ~/.ore-code/config.toml 或项目 .ore-code/config.toml，使用应用设置。",
    category: "core",
    requiredLevel: "optional",
    repairable: false
  };
}

function failure(
  id: string,
  label: string,
  error: unknown,
  status: DoctorStatus = "fail",
  metadata: Partial<DoctorCheck> = {}
): DoctorCheck {
  return {
    id,
    label,
    status,
    detail: error instanceof Error ? error.message : String(error),
    ...metadata
  };
}

function firstNonEmptyLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

async function checkPython(
  processHost: ProcessToolHost,
  workspacePath: string,
  workspaceSignals?: WorkspaceSignals
): Promise<DoctorCheck> {
  const candidates = ["python", "python3", "py"];
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const result = await processHost.run({
        workspacePath,
        program: candidate,
        args: ["--version"],
        timeoutMs: 8_000
      });
      if (result.exitCode === 0) {
        const detectedVersion = firstNonEmptyLine(result.stdout) || firstNonEmptyLine(result.stderr);
        return {
          id: "command:python",
          label: "Python runtime",
          status: "pass",
          detail: detectedVersion ? `${candidate}: ${detectedVersion}` : `${candidate} is available`,
          category: "toolchain",
          requiredLevel: workspaceSignals?.hasPyprojectToml || workspaceSignals?.hasRequirementsTxt ? "recommended" : "optional",
          repairable: false,
          detectedVersion
        };
      }
      errors.push(`${candidate}: ${result.stderr || `exited ${result.exitCode}`}`);
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    id: "command:python",
    label: "Python runtime",
    status: "info",
    detail: errors[0] ?? "python/python3/py was not found on PATH",
    category: "toolchain",
    requiredLevel: workspaceSignals?.hasPyprojectToml || workspaceSignals?.hasRequirementsTxt ? "recommended" : "optional",
    repairable: true,
    installHint: "安装 Python 后可运行 Python 项目、code_execution 和 pyright 相关能力。"
  };
}

function checkCoreEnvironment(paths?: EnvironmentPaths): DoctorCheck[] {
  if (!paths?.userHomePath && !paths?.appDataPath) {
    return [
      {
        id: "core:bootstrap",
        label: "Ore Code core directories",
        status: "info",
        detail: "当前运行环境未提供本机目录信息；桌面端启动时会创建默认目录。",
        category: "core",
        requiredLevel: "required",
        repairable: false
      }
    ];
  }

  const checks: DoctorCheck[] = [];
  if (paths.userHomePath) {
    checks.push({
      id: "core:user-config",
      label: "Ore Code user config",
      status: "pass",
      detail: `用户目录 (${paths.userHomePath}) 下的 .ore-code/config.toml、.ore-code/mcp.json 和 skills 目录会在启动时确保存在。`,
      category: "core",
      requiredLevel: "required",
      repairable: false
    });
  }
  if (paths.appDataPath) {
    checks.push({
      id: "core:app-data",
      label: "Ore Code app data",
      status: "pass",
      detail: `${paths.appDataPath} 已由桌面端用于会话、产物、索引和缓存数据。`,
      category: "core",
      requiredLevel: "required",
      repairable: false
    });
  }
  return checks;
}

function checkProjectSignals(workspaceSignals?: WorkspaceSignals): DoctorCheck[] {
  if (!workspaceSignals) {
    return [
      {
        id: "project:signals",
        label: "Project dependency signals",
        status: "info",
        detail: "未读取当前项目依赖信号。",
        category: "project",
        requiredLevel: "optional",
        repairable: false
      }
    ];
  }

  const checks: DoctorCheck[] = [];
  if (workspaceSignals.hasPackageJson) {
    const manager = workspaceSignals.packageManager ?? "npm";
    checks.push({
      id: "project:node-deps",
      label: "Node project dependencies",
      status: "info",
      detail: `检测到 package.json${workspaceSignals.packageManager ? ` 和 ${workspaceSignals.packageManager} lockfile` : ""}。修复前会先让用户确认，不会自动安装依赖。`,
      category: "project",
      requiredLevel: "recommended",
      repairable: true,
      installHint: `可在当前 workspace 下运行 ${manager} install。`
    });
  }
  if (workspaceSignals.hasCargoToml) {
    checks.push({
      id: "project:cargo-deps",
      label: "Rust project dependencies",
      status: "info",
      detail: "检测到 Cargo.toml。修复前会先让用户确认，不会自动获取依赖。",
      category: "project",
      requiredLevel: "recommended",
      repairable: true,
      installHint: "可在当前 workspace 下运行 cargo fetch。"
    });
  }
  if (workspaceSignals.hasPyprojectToml || workspaceSignals.hasRequirementsTxt) {
    checks.push({
      id: "project:python-deps",
      label: "Python project dependencies",
      status: "info",
      detail: `检测到 ${workspaceSignals.hasPyprojectToml ? "pyproject.toml" : "requirements.txt"}。第一版只提示手动处理，不自动安装 Python 依赖。`,
      category: "project",
      requiredLevel: "optional",
      repairable: false,
      installHint: "请按项目约定创建虚拟环境并安装 Python 依赖。"
    });
  }

  if (checks.length === 0) {
    checks.push({
      id: "project:signals",
      label: "Project dependency signals",
      status: "pass",
      detail: "未检测到需要补齐的常见项目依赖文件。",
      category: "project",
      requiredLevel: "optional",
      repairable: false
    });
  }
  return checks;
}

export async function detectWorkspaceSignals(fileHost: FileToolHost, workspacePath: string): Promise<WorkspaceSignals> {
  const names = new Set<string>();
  try {
    const output = await fileHost.listDir({ workspacePath, path: "." });
    for (const entry of output.entries) {
      names.add(entry.name);
    }
  } catch {
    return {
      hasPackageJson: false,
      hasCargoToml: false,
      hasPyprojectToml: false,
      hasRequirementsTxt: false
    };
  }

  return {
    hasPackageJson: names.has("package.json"),
    packageManager: detectPackageManager(names),
    hasCargoToml: names.has("Cargo.toml"),
    hasPyprojectToml: names.has("pyproject.toml"),
    hasRequirementsTxt: names.has("requirements.txt")
  };
}

function detectPackageManager(names: Set<string>): ProjectPackageManager | undefined {
  if (names.has("pnpm-lock.yaml")) return "pnpm";
  if (names.has("package-lock.json")) return "npm";
  if (names.has("yarn.lock")) return "yarn";
  if (names.has("bun.lockb") || names.has("bun.lock")) return "bun";
  return undefined;
}
