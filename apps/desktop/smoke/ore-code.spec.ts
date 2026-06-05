import { expect, type Locator, type Page, test } from "@playwright/test";

const smokeWorkspace = "/tmp/ore-code-smoke-workspace";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("ore-code.user-config.toml", "provider = \"mock\"\n");
  });
});

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

  await workspaceControl(page).getByRole("button", { name: /Show right panel|显示右侧面板/ }).click();
  await expect(page.locator(".inspector")).toBeVisible();

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

  expect(metrics.mainRight).toBeLessThan(metrics.viewport);
  expect(metrics.mainWidth).toBeGreaterThan(1100);
  expect(metrics.inspectorLeft).toBeGreaterThanOrEqual(metrics.mainRight - 2);
  expect(metrics.inspectorWidth).toBeGreaterThan(340);

  await page.keyboard.press("Escape");
  await expect(page.locator(".inspector")).toHaveCount(0);
});

test("creates a new conversation after choosing a workspace path", async ({ page }) => {
  await page.goto("/");
  await applyBrowserWorkspace(page);

  await page
    .getByRole("navigation", { name: "Primary actions" })
    .getByRole("button", { name: /New Chat|新对话/ })
    .click();

  await expect(page.getByRole("region", { name: "新对话" })).toBeVisible();
  await expect(page.getByText("ore-code-smoke-workspace").first()).toBeVisible();
  await page.getByRole("button", { name: "创建对话" }).click();

  await expect(page.getByRole("region", { name: "新对话" })).toHaveCount(0);
  await expect(page.getByText("已创建新会话。")).toBeVisible();
});

test("keeps user messages right aligned in the transcript", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto("/");
  await applyBrowserWorkspace(page);

  await submitPrompt(page, "列出当前工作区并总结项目结构");
  await expect(page.locator(".message.user").first()).toBeVisible();

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
  await applyBrowserWorkspace(page);

  await submitPrompt(page, "写入 @ore-code-smoke-one.txt");
  await approveIfVisible(page);

  await expect(page.getByText("已编辑 ore-code-smoke-one.txt")).toBeVisible();
  await page.getByRole("button", { name: "审核" }).click();
  const changesPanel = page.getByRole("complementary", { name: "代码变更" });
  await expect(changesPanel).toBeVisible();
  await expect(changesPanel.getByText("ore-code-smoke-one.txt").first()).toBeVisible();
  await expect(changesPanel.getByRole("region", { name: "代码变更预览" })).toBeVisible();

  await changesPanel.getByRole("button", { name: "复制 diff" }).click();
  await changesPanel.getByRole("button", { name: "撤销" }).click();

  await expect(page.getByText("已撤销 ore-code-smoke-one.txt")).toBeVisible();
  await expect(page.getByText("已编辑 ore-code-smoke-one.txt")).toHaveCount(0);
});

test("shows verification failure for browser-preview shell execution", async ({ page }) => {
  await page.goto("/");
  await applyBrowserWorkspace(page);

  await submitPrompt(page, "运行 pnpm test");
  await approveIfVisible(page);

  await expect(page.getByText("测试失败：pnpm test（exit 127）")).toBeVisible();
});

test("shows MCP source state in browser preview", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Skills|技能/ }).click();
  const skillsPanel = page.getByRole("region", { name: "MCP 与技能" });
  await skillsPanel.getByRole("button", { name: "MCP" }).click();

  await expect(skillsPanel.getByText("MCP 不可用").first()).toBeVisible();
  await expect(skillsPanel.getByText("浏览器预览不支持启动或连接 MCP server，请在 Tauri 桌面端运行。")).toBeVisible();
});

function workspaceControl(page: Page): Locator {
  return page.getByLabel("Workspace controls");
}

async function applyBrowserWorkspace(page: Page) {
  await workspaceControl(page).getByRole("button", { name: /Settings|设置/ }).click();
  await expect(page.getByRole("region", { name: /Settings|设置/ })).toBeVisible();
  await page
    .getByRole("navigation", { name: /Settings categories|设置分类/ })
    .getByRole("button", { name: /Workspace|工作区/ })
    .click();
  await page.locator(".settings-section").filter({ hasText: /Default Workspace|默认工作区/ }).getByRole("textbox").fill(smokeWorkspace);
  await page.getByRole("button", { name: /Apply Path|应用路径/ }).click();
  await expect(page.getByText(smokeWorkspace).first()).toBeVisible();
  await page.getByRole("button", { name: /Back|返回/ }).click();
  await expect(page.getByRole("region", { name: /Settings|设置/ })).toHaveCount(0);
}

async function submitPrompt(page: Page, prompt: string) {
  await page.getByLabel("Prompt composer").fill(prompt);
  await page.getByLabel(/Send|发送/).click();
}

async function approveIfVisible(page: Page) {
  const approveButton = page.getByRole("button", { name: /Approve once|批准一次/ });
  try {
    await expect(approveButton).toBeVisible({ timeout: 3_000 });
    await approveButton.click();
  } catch {
    // Some low-risk mock flows do not request approval.
  }
}
