import { describe, expect, it } from "vitest";
import type { ProcessRunOutput, ProcessToolHost } from "@ore-code/tools";
import {
  buildEnvironmentInstallPlan,
  runEnvironmentInstallPlan,
  type EnvironmentInstallStepResult
} from "./environmentInstallPlan";
import type { DoctorCheck, WorkspaceSignals } from "./workspaceDoctor";

describe("buildEnvironmentInstallPlan", () => {
  it("generates Windows structured toolchain commands", () => {
    const plan = buildEnvironmentInstallPlan(
      [
        missingCommand("git"),
        missingCommand("node"),
        missingCommand("pnpm"),
        passCommand("cargo"),
        passCommand("python")
      ],
      "windows",
      emptySignals(),
      "C:\\repo"
    );

    expect(plan.steps.map((step) => [step.id, step.command?.program, step.command?.args[0]])).toEqual([
      ["install:git", "winget", "install"],
      ["install:node", "winget", "install"],
      ["enable:pnpm", "corepack", "enable"]
    ]);
    expect(plan.executableStepCount).toBe(3);
  });

  it("generates macOS brew/corepack commands", () => {
    const plan = buildEnvironmentInstallPlan(
      [missingCommand("git"), missingCommand("node"), missingCommand("pnpm")],
      "macos",
      emptySignals(),
      "/repo"
    );

    expect(plan.steps.map((step) => step.command && [step.command.program, step.command.args.join(" ")])).toEqual([
      ["brew", "install git"],
      ["brew", "install node"],
      ["corepack", "enable pnpm"]
    ]);
  });

  it("keeps Linux system installs as manual hints", () => {
    const plan = buildEnvironmentInstallPlan([missingCommand("git")], "linux", emptySignals(), "/repo");

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.command).toBeUndefined();
    expect(plan.steps[0]?.manualHint).toContain("系统包管理器");
    expect(plan.executableStepCount).toBe(0);
  });

  it("adds project dependency steps under the current workspace", () => {
    const signals: WorkspaceSignals = {
      hasPackageJson: true,
      packageManager: "pnpm",
      hasCargoToml: true,
      hasPyprojectToml: true,
      hasRequirementsTxt: false
    };
    const plan = buildEnvironmentInstallPlan([], "macos", signals, "/repo");

    expect(plan.steps.map((step) => [step.id, step.command?.program, step.command?.args.join(" "), step.command?.workspacePath])).toEqual([
      ["project:pnpm:install", "pnpm", "install", "/repo"],
      ["project:cargo:fetch", "cargo", "fetch", "/repo"],
      ["project:python:manual", undefined, undefined, undefined]
    ]);
  });
});

describe("runEnvironmentInstallPlan", () => {
  it("continues after command failures and reports manual steps", async () => {
    const plan = buildEnvironmentInstallPlan(
      [missingCommand("git")],
      "macos",
      {
        hasPackageJson: true,
        packageManager: "npm",
        hasCargoToml: false,
        hasPyprojectToml: true,
        hasRequirementsTxt: false
      },
      "/repo"
    );
    const updates: EnvironmentInstallStepResult[] = [];
    const result = await runEnvironmentInstallPlan(
      plan,
      processHostWithCommands({
        "brew install git": processFail("brew not found"),
        "npm install": processOk("installed\n")
      }),
      (stepResult) => updates.push(stepResult)
    );

    expect(result.results.map((stepResult) => [stepResult.stepId, stepResult.status])).toEqual([
      ["install:git", "failed"],
      ["project:npm:install", "succeeded"],
      ["project:python:manual", "skipped"]
    ]);
    expect(updates).toHaveLength(3);
    expect(result.ok).toBe(false);
  });
});

function missingCommand(command: string): DoctorCheck {
  return {
    id: `command:${command}`,
    label: command,
    status: "info",
    detail: `${command} missing`,
    category: "toolchain",
    requiredLevel: "recommended",
    repairable: true
  };
}

function passCommand(command: string): DoctorCheck {
  return {
    id: `command:${command}`,
    label: command,
    status: "pass",
    detail: `${command} ok`,
    category: "toolchain",
    requiredLevel: "recommended",
    repairable: false
  };
}

function emptySignals(): WorkspaceSignals {
  return {
    hasPackageJson: false,
    hasCargoToml: false,
    hasPyprojectToml: false,
    hasRequirementsTxt: false
  };
}

function processHostWithCommands(commands: Record<string, ProcessRunOutput>): ProcessToolHost {
  return {
    async run(input) {
      const command = [input.program, ...(input.args ?? [])].join(" ");
      return commands[command] ?? processFail(`unknown command: ${command}`);
    }
  };
}

function processOk(stdout: string): ProcessRunOutput {
  return {
    program: "",
    args: [],
    command: "",
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: 1,
    timedOut: false
  };
}

function processFail(stderr: string): ProcessRunOutput {
  return {
    program: "",
    args: [],
    command: "",
    exitCode: 127,
    stdout: "",
    stderr,
    durationMs: 1,
    timedOut: false
  };
}
