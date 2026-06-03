import { expect, test } from "@playwright/test";

test("keeps the chat layout full width by default", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto("/");

  const metrics = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) {
        return null;
      }
      const bounds = element.getBoundingClientRect();
      return {
        left: Math.round(bounds.left),
        right: Math.round(bounds.right),
        width: Math.round(bounds.width)
      };
    };
    const workbench = document.querySelector(".workbench");
    return {
      viewport: window.innerWidth,
      root: rect("#root"),
      workbench: rect(".workbench"),
      sidebar: rect(".sidebar"),
      main: rect(".main-column"),
      inspector: rect(".inspector"),
      composer: rect(".composer-shell"),
      grid: workbench ? getComputedStyle(workbench).gridTemplateColumns : ""
    };
  });

  expect(metrics.viewport).toBe(1920);
  expect(metrics.root?.width).toBe(1920);
  expect(metrics.workbench?.width).toBe(1920);
  expect(metrics.inspector).toBeNull();
  expect(metrics.sidebar?.width).toBeGreaterThanOrEqual(260);
  expect(metrics.sidebar?.width).toBeLessThanOrEqual(310);
  expect(metrics.main?.right).toBe(1920);
  expect(metrics.main?.width).toBeGreaterThan(1500);
  expect(metrics.composer?.width).toBeGreaterThan(760);
  expect(metrics.composer?.width).toBeLessThan(920);

  await page.screenshot({ fullPage: true, path: "test-results/ore-code-layout-main.png" });
});

test("opens the inspector as an overlay drawer", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto("/");

  await page.getByLabel("显示右侧面板").click();
  await expect(page.getByLabel("Inspector")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const main = document.querySelector(".main-column")?.getBoundingClientRect();
    const inspector = document.querySelector(".inspector")?.getBoundingClientRect();
    return {
      mainRight: main ? Math.round(main.right) : 0,
      mainWidth: main ? Math.round(main.width) : 0,
      inspectorLeft: inspector ? Math.round(inspector.left) : 0,
      inspectorWidth: inspector ? Math.round(inspector.width) : 0,
      viewport: window.innerWidth
    };
  });

  expect(metrics.mainRight).toBe(1920);
  expect(metrics.mainWidth).toBeGreaterThan(1500);
  expect(metrics.inspectorLeft).toBeGreaterThan(1450);
  expect(metrics.inspectorWidth).toBeGreaterThan(340);

  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Inspector")).toHaveCount(0);
});

test("creates a new conversation after choosing a workspace path", async ({ page }) => {
  await page.goto("/");

  await page
    .getByRole("navigation", { name: "Primary actions" })
    .getByRole("button", { name: "新对话", exact: true })
    .click();
  await expect(page.getByLabel("新对话工作区路径")).toBeVisible();
  await expect(page.getByText("请先选择一个真实工作区")).toBeVisible();

  await page.getByLabel("新对话工作区路径").fill("/tmp/ore-code-smoke-workspace");
  await page.getByRole("button", { name: /应用输入路径/ }).click();
  await expect(page.getByText("浏览器预览：/tmp/ore-code-smoke-workspace")).toBeVisible();
  await page.getByRole("button", { name: "创建对话" }).click();

  await expect(page.getByLabel("新对话工作区路径")).toHaveCount(0);
  await expect(page.getByText("已创建新会话。")).toBeVisible();
});

test("keeps user messages right aligned in the transcript", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto("/");

  await submitPrompt(page, "列出当前工作区并总结项目结构");

  const metrics = await page.evaluate(() => {
    const composer = document.querySelector(".composer-shell")?.getBoundingClientRect();
    const userMessage = document.querySelector(".message.user")?.getBoundingClientRect();
    return {
      composerRight: composer ? Math.round(composer.right) : 0,
      userRight: userMessage ? Math.round(userMessage.right) : 0,
      userLeft: userMessage ? Math.round(userMessage.left) : 0
    };
  });

  expect(Math.abs(metrics.userRight - metrics.composerRight)).toBeLessThanOrEqual(2);
  expect(metrics.userLeft).toBeGreaterThan(900);
});

test("reviews and restores a single turn file change", async ({ page }) => {
  await page.goto("/");

  await submitPrompt(page, "写入 @ore-code-smoke-one.txt");
  await approveIfVisible(page);

  const transcript = page.getByLabel("Transcript");
  await expect(transcript.getByText(/1 个文件已更改/)).toBeVisible();
  await page.getByRole("button", { name: "审核" }).click();
  await expect(page.getByText("审核文件更改")).toBeVisible();
  await expect(page.getByRole("button", { name: /ore-code-smoke-one\.txt/ }).first()).toBeVisible();

  await page.getByRole("button", { name: "复制 diff" }).click();
  await page.getByRole("button", { name: "撤销单文件" }).click();

  await expect(page.getByText("已撤销 ore-code-smoke-one.txt")).toBeVisible();
  await expect(transcript.getByText(/1 个文件已更改/)).toHaveCount(0);
});

test("shows verification failure for browser-preview shell execution", async ({ page }) => {
  await page.goto("/");

  await submitPrompt(page, "运行 pnpm test");
  await approveIfVisible(page);

  await expect(page.locator(".turn-status-line").getByText("验证失败").first()).toBeVisible();
});

test("shows MCP source state in browser preview", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "技能" }).click();
  const skillsPanel = page.getByRole("region", { name: "技能" });
  await skillsPanel.getByRole("button", { name: "插件" }).click();

  await expect(skillsPanel.getByText("MCP 不可用").first()).toBeVisible();
  await expect(skillsPanel.getByText("浏览器预览不支持启动或连接 MCP server，请在 Tauri 桌面端运行。")).toBeVisible();
});

async function submitPrompt(page: import("@playwright/test").Page, prompt: string) {
  await page.getByLabel("Prompt composer").fill(prompt);
  await page.getByLabel("发送").click();
}

async function approveIfVisible(page: import("@playwright/test").Page) {
  const approveButton = page.getByRole("button", { name: "批准一次" });
  try {
    await expect(approveButton).toBeVisible({ timeout: 3_000 });
    await approveButton.click();
  } catch {
    // Some low-risk mock flows do not request approval.
  }
}
