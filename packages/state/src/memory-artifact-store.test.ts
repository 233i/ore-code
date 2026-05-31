import { describe, expect, it } from "vitest";
import { MemoryArtifactStore } from "./memory-artifact-store";

describe("MemoryArtifactStore", () => {
  it("writes, lists, and reads artifacts", async () => {
    const store = new MemoryArtifactStore();

    const metadata = await store.write({
      type: "shell-log",
      content: "stdout\nok\n",
      summary: "test output",
      sourceCallId: "call-1"
    });

    expect(metadata).toMatchObject({
      type: "shell-log",
      size: 10,
      summary: "test output",
      sourceCallId: "call-1"
    });
    expect(metadata.id).toMatch(/^artifact-/);
    await expect(store.list()).resolves.toEqual([metadata]);
    await expect(store.read(metadata.id)).resolves.toMatchObject({
      ...metadata,
      content: "stdout\nok\n"
    });
  });

  it("rejects missing artifacts", async () => {
    const store = new MemoryArtifactStore();

    await expect(store.read("missing")).rejects.toThrow("Artifact not found");
  });
});
