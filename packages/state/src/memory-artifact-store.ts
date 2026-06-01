import type { ArtifactMetadata, ArtifactRecord } from "@ore-code/protocol";

export interface ArtifactWriteInput {
  type: ArtifactMetadata["type"];
  content: string;
  summary: string;
  sourceCallId?: string;
}

export class MemoryArtifactStore {
  private readonly artifacts = new Map<string, ArtifactRecord>();

  async write(input: ArtifactWriteInput): Promise<ArtifactMetadata> {
    const artifact: ArtifactRecord = {
      id: `artifact-${crypto.randomUUID()}`,
      type: input.type,
      size: new TextEncoder().encode(input.content).byteLength,
      createdAt: new Date().toISOString(),
      summary: input.summary,
      sourceCallId: input.sourceCallId,
      content: input.content
    };

    this.artifacts.set(artifact.id, artifact);
    return metadataFor(artifact);
  }

  async read(id: string): Promise<ArtifactRecord> {
    const artifact = this.artifacts.get(id);
    if (!artifact) {
      throw new Error(`Artifact not found: ${id}`);
    }

    return artifact;
  }

  async list(): Promise<ArtifactMetadata[]> {
    return [...this.artifacts.values()].map(metadataFor);
  }
}

function metadataFor(artifact: ArtifactRecord): ArtifactMetadata {
  return {
    id: artifact.id,
    type: artifact.type,
    size: artifact.size,
    createdAt: artifact.createdAt,
    summary: artifact.summary,
    sourceCallId: artifact.sourceCallId
  };
}
