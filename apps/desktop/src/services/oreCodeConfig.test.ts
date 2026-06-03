import { describe, expect, it } from "vitest";
import { DEFAULT_DEEPSEEK_BASE_URL, DEFAULT_DEEPSEEK_MODEL } from "./appSettings";
import { parseMiniToml, resolveOreCodeConfig, resolveProvider } from "./oreCodeConfig";

describe("ore-code config", () => {
  it("overlays global and project config with active profiles", () => {
    const resolved = resolveOreCodeConfig({
      sources: [
        {
          scope: "global",
          path: "~/.ore-code/config.toml",
          status: "loaded",
          content: `
profile = "work"

[providers.deepseek]
model = "deepseek-v4-pro"
base_url = "https://api.deepseek.com/beta"
api_key_env = "DEEPSEEK_API_KEY"

[profiles.work]
provider = "deepseek"
model = "deepseek-v4-flash"
model_mode = "auto"
reasoning_effort = "max"

[profiles.work.context]
enableCacheWarmup = true
`
        },
        {
          scope: "project",
          path: "/repo/.ore-code/config.toml",
          status: "loaded",
          content: `
[profiles.work]
model = "deepseek-v4-pro"
`
        }
      ],
      env: []
    });

    expect(resolved.activeProfile).toBe("work");
    expect(resolved.context.enableCacheWarmup).toBe(true);
    expect(resolved.providerId).toBe("deepseek");
    expect(resolveProvider(resolved, "deepseek")).toMatchObject({
      model: "deepseek-v4-pro",
      deepSeekModelMode: "auto",
      baseUrl: "https://api.deepseek.com/beta",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      deepSeekThinkingLevel: "max"
    });
  });

  it("supports custom OpenAI-compatible providers", () => {
    const resolved = resolveOreCodeConfig({
      sources: [
        {
          scope: "project",
          path: "/repo/.ore-code/config.toml",
          status: "loaded",
          content: `
provider = "local"

[providers.local]
label = "Local Gateway"
model = "deepseek-v4-pro"
base_url = "http://localhost:8080/v1"
api_key_env = "LOCAL_GATEWAY_API_KEY"
`
        }
      ],
      env: []
    });

    expect(resolved.providerId).toBe("local");
    expect(resolveProvider(resolved, "local")).toMatchObject({
      id: "local",
      label: "Local Gateway",
      kind: "openai-compatible",
      model: "deepseek-v4-pro",
      baseUrl: "http://localhost:8080/v1",
      apiKeyEnv: "LOCAL_GATEWAY_API_KEY"
    });
  });

  it("uses stable DeepSeek defaults when config files are missing", () => {
    const resolved = resolveOreCodeConfig({
      sources: [
        { scope: "global", path: "~/.ore-code/config.toml", status: "missing" },
        { scope: "project", path: "/repo/.ore-code/config.toml", status: "missing" }
      ],
      env: []
    });

    expect(resolveProvider(resolved, "deepseek")).toMatchObject({
      model: DEFAULT_DEEPSEEK_MODEL,
      deepSeekModelMode: "auto",
      baseUrl: DEFAULT_DEEPSEEK_BASE_URL
    });
  });

  it("resolves DeepSeek model mode overlay separately from model name", () => {
    const resolved = resolveOreCodeConfig({
      sources: [
        {
          scope: "project",
          path: "/repo/.ore-code/config.toml",
          status: "loaded",
          content: `
[providers.deepseek]
model = "deepseek-v4-pro"
model_mode = "flash"
`
        }
      ],
      env: []
    });

    expect(resolveProvider(resolved, "deepseek")).toMatchObject({
      model: "deepseek-v4-pro",
      deepSeekModelMode: "flash"
    });
  });

  it("parses standard TOML syntax beyond the old mini subset", () => {
    expect(parseMiniToml(`
profile = "work"
enabled = true
tags = ["agent", "desktop"]
notes = """
line one
line two
"""

[providers.deepseek]
model = "v#1" # comment
base_url = "https://api.example.com/v1"

[providers.local]
label = "Local Gateway"
limits = { rpm = 60, burst = 4 }
`)).toMatchObject({
      profile: "work",
      enabled: true,
      tags: ["agent", "desktop"],
      notes: "line one\nline two\n",
      providers: {
        deepseek: {
          model: "v#1",
          base_url: "https://api.example.com/v1"
        },
        local: {
          label: "Local Gateway",
          limits: {
            rpm: 60,
            burst: 4
          }
        }
      }
    });
  });

  it("resolves providers declared with TOML inline tables", () => {
    const resolved = resolveOreCodeConfig({
      sources: [
        {
          scope: "project",
          path: "/repo/.ore-code/config.toml",
          status: "loaded",
          content: `
provider = "local"

[providers]
local = { label = "Local Gateway", model = "deepseek-v4-pro", base_url = "http://localhost:8080/v1", api_key_env = "LOCAL_GATEWAY_API_KEY" }
`
        }
      ],
      env: []
    });

    expect(resolveProvider(resolved, "local")).toMatchObject({
      id: "local",
      label: "Local Gateway",
      model: "deepseek-v4-pro",
      baseUrl: "http://localhost:8080/v1",
      apiKeyEnv: "LOCAL_GATEWAY_API_KEY"
    });
  });
});
