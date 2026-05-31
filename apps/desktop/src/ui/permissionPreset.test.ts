import { describe, expect, it } from "vitest";
import type { ToolCall } from "@seekforge/protocol";
import {
  autoReviewDecisionForCall,
  modeFromPermissionPreset,
  presetFromMode,
  resolvePermissionPreset
} from "./permissionPreset";

describe("permissionPreset", () => {
  it("maps mode and preset labels to runtime modes", () => {
    expect(presetFromMode("agent")).toBe("default");
    expect(presetFromMode("yolo")).toBe("fullAccess");
    expect(modeFromPermissionPreset("default")).toBe("agent");
    expect(modeFromPermissionPreset("autoReview")).toBe("agent");
    expect(modeFromPermissionPreset("fullAccess")).toBe("yolo");
  });

  it("keeps plan mode while honoring full-access workspace trust", () => {
    expect(resolvePermissionPreset("fullAccess", true)).toEqual({
      mode: "plan",
      trustedWorkspace: true
    });
    expect(resolvePermissionPreset("default", true)).toEqual({
      mode: "plan",
      trustedWorkspace: false
    });
    expect(resolvePermissionPreset("fullAccess", false)).toEqual({
      mode: "yolo",
      trustedWorkspace: true
    });
  });

  it("auto-approves only read shell calls in auto review", () => {
    expect(autoReviewDecisionForCall("autoReview", shellCall("git status"))).toEqual({
      callId: "shell-1",
      decision: "approved-once"
    });
    expect(autoReviewDecisionForCall("autoReview", shellCall("rm -rf dist"))).toBeUndefined();
    expect(autoReviewDecisionForCall("default", shellCall("git status"))).toBeUndefined();
  });
});

function shellCall(command: string): ToolCall {
  return {
    id: "shell-1",
    name: "exec_shell",
    capability: "shell",
    approval: "required",
    input: { command }
  };
}
