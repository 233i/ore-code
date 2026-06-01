import type { RuntimeEvent } from "@ore-code/protocol";

export class MemoryEventStore {
  private readonly events: RuntimeEvent[] = [];

  append(event: RuntimeEvent): void {
    this.events.push(event);
  }

  list(): RuntimeEvent[] {
    return [...this.events];
  }
}

