import type { ShellRunOutput } from "./shell-tools";

export type SandboxEnvironmentMode = "minimal" | "inherit-safe";

export interface SandboxPolicy {
  enabled: boolean;
  envMode: SandboxEnvironmentMode;
  allowNetwork: boolean;
  allowReadOutsideWorkspace: boolean;
  allowWriteWorkspace: boolean;
}

export interface SandboxRunMetadata {
  enabled: boolean;
  envMode: SandboxEnvironmentMode;
  sensitiveEnvFiltered: number;
  processTreeKill: boolean;
}

export interface SandboxRunInput {
  workspacePath: string;
  program: string;
  args?: string[];
  stdin?: string;
  timeoutMs: number;
  sandboxPolicy?: SandboxPolicy;
  onOutput?: (delta: { stream: "stdout" | "stderr"; text: string }) => void;
}

export interface SandboxRunOutput extends ShellRunOutput {
  program: string;
  args: string[];
  sandbox?: SandboxRunMetadata;
}

export type ProcessRunInput = SandboxRunInput;
export type ProcessRunOutput = SandboxRunOutput;

export interface ProcessToolHost {
  run(input: ProcessRunInput): Promise<ProcessRunOutput>;
}

export function defaultSandboxPolicy(overrides: Partial<SandboxPolicy> = {}): SandboxPolicy {
  return {
    enabled: true,
    envMode: "inherit-safe",
    allowNetwork: false,
    allowReadOutsideWorkspace: false,
    allowWriteWorkspace: true,
    ...overrides
  };
}

export function codeExecutionSandboxPolicy(): SandboxPolicy {
  return defaultSandboxPolicy({
    envMode: "minimal",
    allowNetwork: false,
    allowReadOutsideWorkspace: false,
    allowWriteWorkspace: false
  });
}

export function runTestsSandboxPolicy(): SandboxPolicy {
  return defaultSandboxPolicy({
    envMode: "inherit-safe",
    allowNetwork: false,
    allowReadOutsideWorkspace: false,
    allowWriteWorkspace: true
  });
}

export function processCommandString(program: string, args: string[] = []) {
  return [program, ...args].map(formatProcessArg).join(" ");
}

function formatProcessArg(value: string) {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : JSON.stringify(value);
}
