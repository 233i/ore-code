import type { GitStatusHostOutput } from "@ore-code/tools";
import { parseUnifiedDiffStats, type ChangeFileStat } from "./changeSummary";

export type ChangeGroup = "turn" | "unstaged" | "staged";

export type ChangeReviewItem = ChangeFileStat & {
  group: ChangeGroup;
};

export type ChangeReviewGroup = {
  id: ChangeGroup;
  label: string;
  files: ChangeReviewItem[];
};

export function buildChangeReviewGroups(input: {
  gitStatus: GitStatusHostOutput | null;
  stagedDiff?: string;
  turnFiles: ChangeFileStat[];
  unstagedDiff?: string;
}): ChangeReviewGroup[] {
  const groups: ChangeReviewGroup[] = [
    { id: "turn", label: "本轮变更", files: input.turnFiles.map((file) => ({ ...file, group: "turn" })) },
    { id: "unstaged", label: "未暂存变更", files: [] },
    { id: "staged", label: "已暂存变更", files: [] }
  ];

  if (!input.gitStatus?.entries.length) {
    return groups.filter((group) => group.files.length > 0);
  }

  const unstaged = groups.find((group) => group.id === "unstaged");
  const staged = groups.find((group) => group.id === "staged");
  const unstagedStats = parseUnifiedDiffStats(input.unstagedDiff ?? "");
  const stagedStats = parseUnifiedDiffStats(input.stagedDiff ?? "");

  for (const entry of input.gitStatus.entries) {
    const path = normalizeGitStatusPath(entry.path);
    const xy = normalizeGitStatusCode(entry.status);
    if (!path) {
      continue;
    }

    if (hasStagedChange(xy)) {
      const stat = stagedStats.get(path) ?? { additions: 0, deletions: 0 };
      staged?.files.push({ path, status: xy, additions: stat.additions, deletions: stat.deletions, group: "staged" });
    }

    if (hasUnstagedChange(xy)) {
      const stat = unstagedStats.get(path) ?? { additions: 0, deletions: 0 };
      unstaged?.files.push({ path, status: xy, additions: stat.additions, deletions: stat.deletions, group: "unstaged" });
    }
  }

  return groups.filter((group) => group.files.length > 0);
}

export function changeGroupLabel(group: ChangeGroup) {
  switch (group) {
    case "turn":
      return "本轮";
    case "staged":
      return "已暂存";
    case "unstaged":
      return "未暂存";
  }
}

function hasStagedChange(status: string) {
  if (status === "??") {
    return false;
  }

  return Boolean(status[0]?.trim());
}

function hasUnstagedChange(status: string) {
  if (status === "??") {
    return true;
  }

  return Boolean(status[1]?.trim());
}

function normalizeGitStatusCode(status: string) {
  if (status === "??") {
    return status;
  }

  return status.padEnd(2, " ").slice(0, 2);
}

function normalizeGitStatusPath(path: string) {
  return path.split(" -> ").pop() ?? path;
}
