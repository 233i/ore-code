import type { RuntimeEvent } from "@seekforge/protocol";

export class MemoryEventStore {
  private readonly events: RuntimeEvent[] = [];

  append(event: RuntimeEvent): void {
    this.events.push(event);
  }

  list(): RuntimeEvent[] {
    return [...this.events];
  }
}

