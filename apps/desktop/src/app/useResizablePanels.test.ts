import { describe, expect, it } from "vitest";
import {
  boundedPanelWidth,
  parseStoredPanelWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH
} from "./useResizablePanels";

describe("parseStoredPanelWidth", () => {
  it("falls back for missing or invalid storage values", () => {
    expect(parseStoredPanelWidth(null, 288, 220, 460)).toBe(288);
    expect(parseStoredPanelWidth("nope", 288, 220, 460)).toBe(288);
  });

  it("clamps stored values into range", () => {
    expect(parseStoredPanelWidth("100", 288, 220, 460)).toBe(220);
    expect(parseStoredPanelWidth("900", 288, 220, 460)).toBe(460);
    expect(parseStoredPanelWidth("320", 288, 220, 460)).toBe(320);
  });
});

describe("boundedPanelWidth", () => {
  it("clamps sidebar width using viewport and inspector constraints", () => {
    expect(boundedPanelWidth("sidebar", 100, {
      inspectorWidth: 460,
      showInspector: true,
      sidebarWidth: 288,
      viewportWidth: 1400
    })).toBe(SIDEBAR_MIN_WIDTH);

    expect(boundedPanelWidth("sidebar", 900, {
      inspectorWidth: 460,
      showInspector: false,
      sidebarWidth: 288,
      viewportWidth: 1400
    })).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("keeps inspector width inside the remaining layout budget", () => {
    expect(boundedPanelWidth("inspector", 900, {
      inspectorWidth: 460,
      showInspector: true,
      sidebarWidth: 460,
      viewportWidth: 1100
    })).toBe(360);
  });
});
