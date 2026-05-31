export type ComposerAttachment = {
  id: string;
  name: string;
  path: string;
  kind: "file" | "image";
  size?: number;
};

export type MessageFeedback = "liked" | "disliked" | null;
