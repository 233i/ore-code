import {
  AgentEngine,
  MockLlmClient,
  type AgentEngineOptions,
  type LlmClient,
  type LlmTurnInput,
  type ModelStreamChunk
} from "@seekforge/agent-core";
import type { RuntimeEvent } from "@seekforge/protocol";

export interface HarnessScenario {
  name: string;
  input: string;
  chunks?: ModelStreamChunk[];
  turns?: ModelStreamChunk[][];
  llm?: LlmClient;
  engineOptions?: AgentEngineOptions;
}

export async function runScenario(scenario: HarnessScenario): Promise<RuntimeEvent[]> {
  const engine = new AgentEngine(resolveScenarioLlm(scenario), scenario.engineOptions);
  const events: RuntimeEvent[] = [];

  for await (const event of engine.startTurn({
    threadId: `thread-${scenario.name}`,
    turnId: `turn-${scenario.name}`,
    text: scenario.input
  })) {
    events.push(event);
  }

  return events;
}

export class ScriptedLlmClient implements LlmClient {
  readonly inputs: LlmTurnInput[] = [];

  constructor(private readonly turns: ModelStreamChunk[][]) {}

  async *streamTurn(input: LlmTurnInput): AsyncIterable<ModelStreamChunk> {
    this.inputs.push(input);
    const chunks = this.turns[this.inputs.length - 1] ?? [{ type: "done" }];

    for (const chunk of chunks) {
      yield chunk;
    }
  }
}

function resolveScenarioLlm(scenario: HarnessScenario): LlmClient {
  if (scenario.llm) {
    return scenario.llm;
  }

  if (scenario.turns) {
    return new ScriptedLlmClient(scenario.turns);
  }

  return new MockLlmClient(scenario.chunks ?? []);
}
