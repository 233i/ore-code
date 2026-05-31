import { describe, expect, it } from "vitest";
import { parsePlanInteractionRequest } from "./plan-interaction";

describe("parsePlanInteractionRequest", () => {
  it("parses valid interaction request blocks", () => {
    expect(parsePlanInteractionRequest([
      "<interaction_request>",
      JSON.stringify({
        type: "interaction_request",
        kind: "choice",
        requestId: "request-1",
        title: "选择项目",
        message: "检测到多个项目。",
        recommendedOptionId: "a",
        options: [
          { id: "a", label: "SeekForge", value: "/repo/SeekForge" },
          { id: "b", label: "PureSFTP", description: "另一个项目" }
        ]
      }),
      "</interaction_request>"
    ].join("\n"))).toEqual({
      requestId: "request-1",
      title: "选择项目",
      message: "检测到多个项目。",
      recommendedOptionId: "a",
      options: [
        { id: "a", label: "SeekForge", value: "/repo/SeekForge" },
        { id: "b", label: "PureSFTP", description: "另一个项目" }
      ]
    });
  });

  it("ignores invalid interaction blocks", () => {
    expect(parsePlanInteractionRequest("<interaction_request>{bad}</interaction_request>")).toBeNull();
    expect(parsePlanInteractionRequest("<interaction_request>{\"title\":\"缺少选项\"}</interaction_request>")).toBeNull();
    expect(parsePlanInteractionRequest("普通回复")).toBeNull();
  });

  it("drops invalid recommendations", () => {
    expect(parsePlanInteractionRequest([
      "<interaction_request>",
      JSON.stringify({
        title: "选择项目",
        message: "检测到多个项目。",
        recommendedOptionId: "missing",
        options: [{ id: "a", label: "SeekForge" }]
      }),
      "</interaction_request>"
    ].join("\n"))?.recommendedOptionId).toBeUndefined();
  });

  it("falls back to a plain-text interaction request for plan clarification text", () => {
    expect(parsePlanInteractionRequest([
      "在我开始之前，想确认几个选择：",
      "",
      "技术栈偏好：你希望用哪种方式？",
      "",
      "纯 HTML/CSS/JS（无需构建工具，开箱即用）",
      "React + TypeScript",
      "Vue + TypeScript",
      "",
      "放置位置：是放在现有目录，还是单独新建 admin_dashboard/？"
    ].join("\n"))).toMatchObject({
      title: "技术栈偏好",
      message: "技术栈偏好：你希望用哪种方式？",
      recommendedOptionId: undefined,
      options: [
        { id: "option-1", label: "纯 HTML/CSS/JS（无需构建工具，开箱即用）" },
        { id: "option-2", label: "React + TypeScript" },
        { id: "option-3", label: "Vue + TypeScript" }
      ]
    });
  });

  it("falls back to a default continuation option when clarification text has no parseable choices", () => {
    expect(parsePlanInteractionRequest("请告诉我你希望放在哪个目录？")).toMatchObject({
      title: "需要确认",
      recommendedOptionId: "use-recommended-default",
      options: [
        { id: "use-recommended-default", label: "按推荐默认方案继续" }
      ]
    });
  });

  it("treats a markdown single-plan confirmation as one clean continuation choice", () => {
    const parsed = parsePlanInteractionRequest([
      "好的，我来为你规划一个简单的管理后台前端页面。",
      "**技术方案**：纯 HTML/CSS/JS，无需构建工具，开箱即用",
      "**放置位置**：新建 `admin_dashboard/` 目录",
      "**包含功能**：仪表盘概览、异常检测结果、诊断 API 管理、事件流监控",
      "确认后我立即开始创建，预计一个完整的单文件页面即可覆盖以上功能。要开始吗？"
    ].join("\n"));

    expect(parsed).toMatchObject({
      title: "确认方案",
      message: "要按上面的方案开始吗？",
      recommendedOptionId: "use-recommended-default",
      options: [
        { id: "use-recommended-default", label: "开始执行" }
      ]
    });
    expect(parsed?.options[0]).not.toHaveProperty("value");
  });

  it("compacts verbose structured interaction requests", () => {
    const parsed = parsePlanInteractionRequest([
      "<interaction_request>",
      JSON.stringify({
        title: "我需要先确认一个非常复杂的多阶段实现方案是否可以开始执行",
        message: [
          "这里是一大段方案说明。",
          "技术栈偏好：你希望用哪种方式？",
          "后面还有很多不应该展示在弹窗里的实现细节。"
        ].join("\n"),
        recommendedOptionId: "html",
        options: [
          { id: "html", label: "纯 HTML/CSS/JS（无需构建工具，开箱即用，适合简单管理后台）", description: "很长的描述".repeat(20) },
          { id: "react", label: "React + TypeScript" },
          { id: "vue", label: "Vue + TypeScript" },
          { id: "next", label: "Next.js" }
        ]
      }),
      "</interaction_request>"
    ].join("\n"));

    expect(parsed).toMatchObject({
      title: "我需要先确认一个非常复杂的多阶…",
      message: "技术栈偏好：你希望用哪种方式？",
      recommendedOptionId: "html"
    });
    expect(parsed?.options).toHaveLength(3);
    expect(parsed?.options[0].label.length).toBeLessThanOrEqual(48);
  });
});
