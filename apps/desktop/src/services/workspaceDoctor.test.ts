import { describe, expect, it } from "vitest";
import type { FileToolHost, ProcessRunOutput, ProcessToolHost, ShellRunOutput, ShellToolHost } from "@ore-code/tools";
import { detectWorkspaceSignals, runEnvironmentDoctor, summarizeDoctor } from "./workspaceDoctor";

describe("runEnvironmentDoctor", () => {
  it("reports a healthy Ore Code runtime environment", async () => {
    const checks = await runEnvironmentDoctor({
      workspacePath: "/workspace",
      provider: "deepseek",
      secretStatus: { provider: "deepseek", source: "keychain", hasSecret: true, last4: "1234" },
      processHost: processWithCommands({
        "git --version": processOk("git version 2.45.0\n"),
        "node --version": processOk("v22.0.0\n"),
        "npm --version": processOk("11.0.0\n"),
        "pnpm --version": processOk("10.0.0\n"),
        "cargo --version": processOk("cargo 1.90.0\n"),
        "python --version": processOk("Python 3.12.0\n"),
        "npx --version": processOk("11.0.0\n")
      }),
      shellHost: shellWithCommands({
        "echo ore-code-shell-ok": ok("ore-code-shell-ok\n")
      }),
      environmentPaths: {
        appDataPath: "/Users/test/Library/Application Support/Ore Code",
        userHomePath: "/Users/test"
      },
      workspaceSignals: {
        hasPackageJson: false,
        hasCargoToml: false,
        hasPyprojectToml: false,
        hasRequirementsTxt: false
      }
    });

    expect(checks.find((check) => check.id === "core:user-config")?.status).toBe("pass");
    expect(checks.find((check) => check.id === "core:app-data")?.status).toBe("pass");
    expect(checks.find((check) => check.id === "command:python")?.detectedVersion).toBe("Python 3.12.0");
    expect(checks.find((check) => check.id === "command:node")?.category).toBe("toolchain");
    expect(checks.find((check) => check.id === "provider")?.status).toBe("pass");
    expect(summarizeDoctor(checks)).toBe("12 checks passed");
  });

  it("does not treat workspace state or pnpm as hard runtime requirements", async () => {
    const checks = await runEnvironmentDoctor({
      workspacePath: ".",
      provider: "deepseek",
      secretStatus: { provider: "deepseek", source: "missing", hasSecret: false },
      processHost: processWithCommands({
        "git --version": processFail("git not found"),
        "node --version": processOk("v22.0.0\n"),
        "npm --version": processFail("npm not found"),
        "pnpm --version": processFail("pnpm not found"),
        "cargo --version": processFail("cargo not found"),
        "python --version": processFail("python not found"),
        "python3 --version": processFail("python3 not found"),
        "py --version": processFail("py not found"),
        "npx --version": processFail("npx not found")
      }),
      shellHost: shellWithCommands({
        "echo ore-code-shell-ok": ok("ore-code-shell-ok\n")
      })
    });

    expect(checks.find((check) => check.id === "workspace")).toBeUndefined();
    expect(checks.find((check) => check.id === "command:git")?.status).toBe("warn");
    expect(checks.find((check) => check.id === "command:pnpm")?.status).toBe("info");
    expect(checks.find((check) => check.id === "command:cargo")?.status).toBe("info");
    expect(checks.find((check) => check.id === "command:python")?.repairable).toBe(true);
    expect(checks.find((check) => check.id === "provider")?.status).toBe("warn");
    expect(summarizeDoctor(checks)).toContain("warnings");
  });

  it("detects project dependency signals from workspace files", async () => {
    const signals = await detectWorkspaceSignals(fileHostWithEntries(["package.json", "pnpm-lock.yaml", "Cargo.toml"]), "/workspace");

    expect(signals).toEqual({
      hasPackageJson: true,
      packageManager: "pnpm",
      hasCargoToml: true,
      hasPyprojectToml: false,
      hasRequirementsTxt: false
    });
  });

  it("marks detected project dependencies as confirm-before-repair", async () => {
    const checks = await runEnvironmentDoctor({
      workspacePath: "/workspace",
      provider: "mock",
      secretStatus: null,
      processHost: processWithCommands({
        "git --version": processOk("git version 2.45.0\n"),
        "node --version": processOk("v22.0.0\n"),
        "npm --version": processOk("11.0.0\n"),
        "pnpm --version": processFail("pnpm not found"),
        "cargo --version": processFail("cargo not found"),
        "python --version": processFail("python not found"),
        "python3 --version": processFail("python3 not found"),
        "py --version": processFail("py not found"),
        "npx --version": processOk("11.0.0\n")
      }),
      shellHost: shellWithCommands({
        "echo ore-code-shell-ok": ok("ore-code-shell-ok\n")
      }),
      workspaceSignals: {
        hasPackageJson: true,
        packageManager: "pnpm",
        hasCargoToml: true,
        hasPyprojectToml: false,
        hasRequirementsTxt: false
      }
    });

    expect(checks.find((check) => check.id === "command:pnpm")?.requiredLevel).toBe("recommended");
    expect(checks.find((check) => check.id === "project:node-deps")?.repairable).toBe(true);
    expect(checks.find((check) => check.id === "project:cargo-deps")?.installHint).toContain("cargo fetch");
  });
});

function processWithCommands(commands: Record<string, ProcessRunOutput>): ProcessToolHost {
  return {
    async run(input) {
      const command = [input.program, ...(input.args ?? [])].join(" ");
      return commands[command] ?? processFail(`unknown command: ${command}`);
    }
  };
}

function shellWithCommands(commands: Record<string, ShellRunOutput>): ShellToolHost {
  return {
    async run(input) {
      return commands[input.command] ?? fail(`unknown command: ${input.command}`);
    }
  };
}

function fileHostWithEntries(names: string[]): FileToolHost {
  return {
    async listDir(input) {
      return {
        entries: names.map((name) => ({
          name,
          path: `${input.workspacePath}/${name}`,
          isDir: false
        }))
      };
    },
    async readText() {
      throw new Error("not implemented");
    },
    async searchFiles() {
      return { matches: [], truncated: false };
    },
    async grepFiles() {
      return { matches: [], truncated: false };
    },
    async writeText(input) {
      return { path: input.path, bytesWritten: input.content.length };
    }
  };
}

function ok(stdout: string): ShellRunOutput {
  return {
    command: "",
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: 1,
    timedOut: false
  };
}

function fail(stderr: string): ShellRunOutput {
  return {
    command: "",
    exitCode: 127,
    stdout: "",
    stderr,
    durationMs: 1,
    timedOut: false
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
