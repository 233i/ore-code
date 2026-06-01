import { describe, expect, it } from "vitest";
import {
  addWorkspacePathPreservingOrder,
  formatWorkspacePathForDisplay,
  normalizeWorkspacePath,
  sameWorkspacePath,
  workspaceProjectName
} from "./workspacePath";

describe("workspace path formatting", () => {
  it("hides Windows verbatim prefixes in display labels", () => {
    expect(formatWorkspacePathForDisplay("\\\\?\\D:\\AiStudy\\Ore Code-code-202605")).toBe("D:\\AiStudy\\Ore Code-code-202605");
    expect(formatWorkspacePathForDisplay("\\\\?\\UNC\\server\\share\\Ore Code")).toBe("\\\\server\\share\\Ore Code");
  });

  it("derives project names from Windows paths", () => {
    expect(workspaceProjectName("\\\\?\\D:\\AiStudy\\Ore Code-code-202605")).toBe("Ore Code-code-202605");
    expect(workspaceProjectName("D:\\AiStudy\\Ore Code")).toBe("Ore Code");
    expect(workspaceProjectName(".")).toBe("Ore Code");
  });

  it("normalizes Windows paths for comparison and recent path dedupe", () => {
    expect(normalizeWorkspacePath("\\\\?\\D:\\AiStudy\\Ore Code\\")).toBe("D:/AiStudy/Ore Code");
    expect(sameWorkspacePath("\\\\?\\D:\\AiStudy\\Ore Code", "D:/AiStudy/Ore Code/")).toBe(true);
    expect(addWorkspacePathPreservingOrder(["D:/AiStudy/Ore Code"], "\\\\?\\D:\\AiStudy\\Ore Code")).toEqual(["D:/AiStudy/Ore Code"]);
  });
});
