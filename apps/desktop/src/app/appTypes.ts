export type Panel = "Files" | "Changes" | "Jobs" | "Skills" | "Artifacts" | "Usage";

export type ResizablePanel = "sidebar" | "inspector";

export type ProjectIndexStatus = {
  documentCount: number;
  message?: string;
  rebuiltDocuments?: number;
  reusedDocuments?: number;
  skippedDocuments?: number;
  state: "idle" | "indexing" | "ready" | "empty" | "error";
  updatedAt?: string;
};
