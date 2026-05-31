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
    expect(formatWorkspacePathForDisplay("\\\\?\\D:\\AiStudy\\SeekForge-code-202605")).toBe("D:\\AiStudy\\SeekForge-code-202605");
    expect(formatWorkspacePathForDisplay("\\\\?\\UNC\\server\\share\\SeekForge")).toBe("\\\\server\\share\\SeekForge");
  });

  it("derives project names from Windows paths", () => {
    expect(workspaceProjectName("\\\\?\\D:\\AiStudy\\SeekForge-code-202605")).toBe("SeekForge-code-202605");
    expect(workspaceProjectName("D:\\AiStudy\\SeekForge")).toBe("SeekForge");
    expect(workspaceProjectName(".")).toBe("SeekForge");
  });

  it("normalizes Windows paths for comparison and recent path dedupe", () => {
    expect(normalizeWorkspacePath("\\\\?\\D:\\AiStudy\\SeekForge\\")).toBe("D:/AiStudy/SeekForge");
    expect(sameWorkspacePath("\\\\?\\D:\\AiStudy\\SeekForge", "D:/AiStudy/SeekForge/")).toBe(true);
    expect(addWorkspacePathPreservingOrder(["D:/AiStudy/SeekForge"], "\\\\?\\D:\\AiStudy\\SeekForge")).toEqual(["D:/AiStudy/SeekForge"]);
  });
});
