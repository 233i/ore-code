import { describe, expect, it } from "vitest";
import { normalizePlatformName } from "./runtimePlatform";

describe("runtimePlatform", () => {
  it("detects common desktop operating systems from browser platform strings", () => {
    expect(normalizePlatformName("Win32", "Mozilla/5.0")).toBe("windows");
    expect(normalizePlatformName("MacIntel", "Mozilla/5.0")).toBe("macos");
    expect(normalizePlatformName("Linux x86_64", "Mozilla/5.0")).toBe("linux");
  });

  it("falls back to unknown when platform information is unavailable", () => {
    expect(normalizePlatformName("", "")).toBe("unknown");
  });
});
