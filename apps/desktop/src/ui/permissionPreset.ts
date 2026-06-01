import type { ApprovalDecision, ToolCall } from "@ore-code/protocol";
import { assessCommandRisk } from "@ore-code/tools";

export type AppMode = "plan" | "agent" | "yolo";
export type PermissionPreset = "default" | "autoReview" | "fullAccess";

export type PermissionResolution = {
  mode: AppMode;
  trustedWorkspace: boolean;
};

export function presetFromMode(mode: AppMode): PermissionPreset {
  if (mode === "yolo") {
    return "fullAccess";
  }

  return "default";
}

export function resolvePermissionPreset(preset: PermissionPreset, planMode: boolean): PermissionResolution {
  if (planMode) {
    return { mode: "plan", trustedWorkspace: preset === "fullAccess" };
  }

  if (preset === "fullAccess") {
    return { mode: "yolo", trustedWorkspace: true };
  }

  return { mode: "agent", trustedWorkspace: false };
}

export function modeFromPermissionPreset(preset: PermissionPreset): AppMode {
  return resolvePermissionPreset(preset, false).mode;
}

export function autoReviewDecisionForCall(
  preset: PermissionPreset,
  call: ToolCall
): ApprovalDecision | undefined {
  if (preset !== "autoReview" || call.capability !== "shell") {
    return undefined;
  }

  const command = typeof (call.input as { command?: unknown } | undefined)?.command === "string"
    ? String((call.input as { command: string }).command)
    : "";

  if (!command) {
    return undefined;
  }

  const risk = assessCommandRisk(command);
  if (risk.level === "read") {
    return { callId: call.id, decision: "approved-once" };
  }

  return undefined;
}

export function permissionPresetLabel(preset: PermissionPreset): string {
  switch (preset) {
    case "autoReview":
      return "自动审查";
    case "fullAccess":
      return "完全访问权限";
    default:
      return "默认权限";
  }
}
