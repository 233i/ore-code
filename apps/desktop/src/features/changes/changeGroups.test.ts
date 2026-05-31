import { describe, expect, it } from "vitest";
import { buildChangeReviewGroups } from "./changeGroups";

describe("buildChangeReviewGroups", () => {
  it("keeps current turn changes separate from git workspace changes", () => {
    const groups = buildChangeReviewGroups({
      turnFiles: [{ path: "src/App.tsx", status: "M", additions: 2, deletions: 1 }],
      unstagedDiff: [
        "diff --git a/src/unstaged.ts b/src/unstaged.ts",
        "--- a/src/unstaged.ts",
        "+++ b/src/unstaged.ts",
        "@@ -1 +1,2 @@",
        "-old",
        "+new",
        "+next",
        "diff --git a/src/both.ts b/src/both.ts",
        "--- a/src/both.ts",
        "+++ b/src/both.ts",
        "@@ -1 +1 @@",
        "-unstaged-old",
        "+unstaged-new"
      ].join("\n"),
      stagedDiff: [
        "diff --git a/src/staged.ts b/src/staged.ts",
        "--- a/src/staged.ts",
        "+++ b/src/staged.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new"
      ].join("\n"),
      gitStatus: {
        isRepo: true,
        raw: "",
        entries: [
          { status: " M", path: "src/unstaged.ts" },
          { status: "M ", path: "src/staged.ts" },
          { status: "MM", path: "src/both.ts" },
          { status: "??", path: "src/new.ts" }
        ]
      }
    });

    expect(groups.find((group) => group.id === "turn")?.files.map((file) => file.path)).toEqual(["src/App.tsx"]);
    expect(groups.find((group) => group.id === "unstaged")?.files.map((file) => file.path)).toEqual([
      "src/unstaged.ts",
      "src/both.ts",
      "src/new.ts"
    ]);
    expect(groups.find((group) => group.id === "staged")?.files.map((file) => file.path)).toEqual([
      "src/staged.ts",
      "src/both.ts"
    ]);
    expect(groups.find((group) => group.id === "unstaged")?.files[0]).toMatchObject({
      path: "src/unstaged.ts",
      additions: 2,
      deletions: 1
    });
    expect(groups.find((group) => group.id === "staged")?.files[0]).toMatchObject({
      path: "src/staged.ts",
      additions: 1,
      deletions: 1
    });
  });

  it("omits empty change groups", () => {
    expect(buildChangeReviewGroups({ turnFiles: [], gitStatus: null })).toEqual([]);
  });
});
