import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { ResizablePanel } from "./appTypes";

const SIDEBAR_WIDTH_STORAGE_KEY = "ore-code.layout.sidebar-width";
const INSPECTOR_WIDTH_STORAGE_KEY = "ore-code.layout.inspector-width";
const SIDEBAR_DEFAULT_WIDTH = 288;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 460;
const INSPECTOR_DEFAULT_WIDTH = 460;
export const INSPECTOR_MIN_WIDTH = 360;
export const INSPECTOR_MAX_WIDTH = 780;
export const MAIN_MIN_WIDTH = 420;

export function useResizablePanels({ showInspector }: { showInspector: boolean }) {
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredPanelWidth(SIDEBAR_WIDTH_STORAGE_KEY, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
  );
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    readStoredPanelWidth(
      INSPECTOR_WIDTH_STORAGE_KEY,
      INSPECTOR_DEFAULT_WIDTH,
      INSPECTOR_MIN_WIDTH,
      INSPECTOR_MAX_WIDTH
    )
  );

  function startPanelResize(panel: ResizablePanel, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel === "sidebar" ? sidebarWidth : inspectorWidth;
    let nextWidth = startWidth;

    document.body.classList.add("panel-resizing");

    const applyWidth = (width: number) => {
      nextWidth = boundedPanelWidth(panel, width, {
        inspectorWidth,
        showInspector,
        sidebarWidth,
        viewportWidth: window.innerWidth
      });
      if (panel === "sidebar") {
        setSidebarWidth(nextWidth);
      } else {
        setInspectorWidth(nextWidth);
      }
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      applyWidth(panel === "sidebar" ? startWidth + delta : startWidth - delta);
    };

    const onPointerUp = () => {
      document.body.classList.remove("panel-resizing");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      writeStoredPanelWidth(panel === "sidebar" ? SIDEBAR_WIDTH_STORAGE_KEY : INSPECTOR_WIDTH_STORAGE_KEY, nextWidth);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  const workbenchStyle = {
    "--inspector-width": `${inspectorWidth}px`,
    "--sidebar-width": `${sidebarWidth}px`
  } as CSSProperties;

  return {
    inspectorWidth,
    sidebarWidth,
    startPanelResize,
    workbenchStyle
  };
}

export function readStoredPanelWidth(key: string, fallback: number, min: number, max: number) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    return parseStoredPanelWidth(window.localStorage.getItem(key), fallback, min, max);
  } catch {
    return fallback;
  }
}

export function parseStoredPanelWidth(value: string | null, fallback: number, min: number, max: number) {
  if (value === null || value.trim() === "") {
    return fallback;
  }
  const stored = Number(value);
  return Number.isFinite(stored) ? clamp(stored, min, max) : fallback;
}

export function writeStoredPanelWidth(key: string, width: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // Layout persistence is best-effort.
  }
}

export function boundedPanelWidth(
  panel: ResizablePanel,
  width: number,
  input: {
    inspectorWidth: number;
    showInspector: boolean;
    sidebarWidth: number;
    viewportWidth: number;
  }
) {
  if (panel === "sidebar") {
    const dynamicMax = input.viewportWidth - MAIN_MIN_WIDTH - (input.showInspector ? input.inspectorWidth : 0);
    return clamp(width, SIDEBAR_MIN_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, dynamicMax)));
  }

  const dynamicMax = input.viewportWidth - input.sidebarWidth - MAIN_MIN_WIDTH;
  return clamp(width, INSPECTOR_MIN_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, Math.min(INSPECTOR_MAX_WIDTH, dynamicMax)));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
