import type { ToolCardState } from "./toolCards";

export type CommandOutputPreviewData = {
  stdout: string;
  stderr: string;
  truncated: boolean;
};

export type RetrievedArtifactSlice = {
  artifactId: string;
  mode: string;
  stream: string;
  content: string;
  totalLines: number;
  returnedLines: {
    start: number;
    end: number;
  };
  truncated: boolean;
  charTruncated: boolean;
};

export type MarkdownReadFile = {
  path: string;
  content: string;
};

export type ToolPresentation = {
  label: string;
  payloadPolicy?: "default" | "compact";
  runningText?: string;
  summary?: (card: ToolCardState) => string | null;
};
