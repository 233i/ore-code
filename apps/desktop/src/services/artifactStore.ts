import { invoke } from "@tauri-apps/api/core";
import { MemoryArtifactStore, type ArtifactWriteInput } from "@seekforge/state";
import {
  ArtifactMetadataSchema,
  ArtifactRecordSchema,
  type ArtifactMetadata,
  type ArtifactRecord
} from "@seekforge/protocol";
import { isTauriRuntime } from "./fileHost";

export interface ArtifactStore {
  write(input: ArtifactWriteInput): Promise<ArtifactMetadata>;
  read(id: string): Promise<ArtifactRecord>;
  list(): Promise<ArtifactMetadata[]>;
}

const browserArtifactStore = new MemoryArtifactStore();

export function createRuntimeArtifactStore(): ArtifactStore {
  if (isTauriRuntime()) {
    return createTauriArtifactStore();
  }

  return browserArtifactStore;
}

function createTauriArtifactStore(): ArtifactStore {
  return {
    async write(input): Promise<ArtifactMetadata> {
      const result = await invoke<unknown>("artifact_write", {
        artifactType: input.type,
        content: input.content,
        summary: input.summary,
        sourceCallId: input.sourceCallId
      });
      return ArtifactMetadataSchema.parse(result);
    },
    async read(id): Promise<ArtifactRecord> {
      const result = await invoke<unknown>("artifact_read", { artifactId: id });
      return ArtifactRecordSchema.parse(result);
    },
    async list(): Promise<ArtifactMetadata[]> {
      const result = await invoke<unknown>("artifact_list");
      return ArtifactMetadataSchema.array().parse(result);
    }
  };
}
