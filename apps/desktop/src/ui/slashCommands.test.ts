import { describe, expect, it } from "vitest";
import {
  completeSlashCommand,
  matchSlashCommands,
  parseSlashCommand,
  shouldCompleteSlashCommand
} from "./slashCommands";

describe("slashCommands", () => {
  it("parses slash command names and arguments", () => {
    expect(parseSlashCommand("/rename 新标题")).toEqual({ name: "/rename", args: "新标题" });
    expect(parseSlashCommand(" /config providers ")).toEqual({ name: "/config", args: "providers" });
    expect(parseSlashCommand("运行测试")).toBeNull();
  });

  it("matches commands by prefix", () => {
    expect(matchSlashCommands("/co").map((command) => command.name)).toEqual(["/config"]);
    expect(matchSlashCommands("/").length).toBeGreaterThan(5);
  });

  it("knows when a highlighted command should be completed", () => {
    const [config] = matchSlashCommands("/co");

    expect(shouldCompleteSlashCommand("/co", config)).toBe(true);
    expect(shouldCompleteSlashCommand("/config", config)).toBe(false);
    expect(completeSlashCommand(config)).toBe("/config ");
  });
});
