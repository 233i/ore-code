import type { RuntimeOperatingSystem } from "@seekforge/agent-core";

export function detectRuntimeOperatingSystem(): RuntimeOperatingSystem {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  return normalizePlatformName(navigator.platform, navigator.userAgent);
}

export function normalizePlatformName(platform = "", userAgent = ""): RuntimeOperatingSystem {
  const value = `${platform} ${userAgent}`.toLowerCase();
  if (value.includes("win")) {
    return "windows";
  }
  if (value.includes("mac") || value.includes("darwin")) {
    return "macos";
  }
  if (value.includes("linux") || value.includes("x11")) {
    return "linux";
  }
  return "unknown";
}
