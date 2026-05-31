# DeepSeek V4 Context Strategy

This document describes how SeekForge treats DeepSeek V4 Pro and Flash as large-context coding models. It is the public design reference for context capacity, history retention, tool output routing, reasoning replay, and prefix-cache stability.

## Goals

- Use the DeepSeek V4 1M context window intentionally instead of carrying older 128K-era truncation defaults.
- Keep the current request explainable: users should be able to see estimated input tokens, input budget, output reservation, safety headroom, seam level, and cache-prefix state.
- Preserve long-session coding continuity without pushing raw shell, web, MCP, diff, or artifact output into every later request.
- Keep DeepSeek thinking plus tool-call history valid by replaying required `reasoning_content`.
- Keep stable prompt layers byte-stable where possible so DeepSeek prefix cache can be effective.

## Model Budgets

SeekForge derives request budgets from the selected model:

| Model family | Context window | Output reservation | Safety headroom | Input budget |
| --- | ---: | ---: | ---: | ---: |
| `deepseek-v4-pro` | 1,000,000 | 65,536 | 4,096 | 930,368 |
| `deepseek-v4-flash` | 1,000,000 | 65,536 | 4,096 | 930,368 |
| Legacy `deepseek-chat` / `deepseek-reasoner` | 128,000 | 8,192 | 4,096 | 115,712 |
| Unknown models | 128,000 | 8,192 | 4,096 | 115,712 |

The input budget is:

```text
contextWindow - maxOutputTokens - safetyHeadroomTokens
```

Explicit caller overrides for `maxInputTokens` remain supported for tests and narrow runtime scenarios, but normal desktop execution should pass the active provider model and let the budget derive from model metadata.

## Capacity Estimation

Capacity reporting estimates the full model request, not only visible chat text. The estimate includes:

- System, user, assistant, and tool messages.
- `reasoningContent` carried by assistant history.
- Tool-call JSON payloads and tool-result content.
- Tool schemas and MCP gateway schemas.
- Framing overhead for messages, tool schemas, and structured request segments.

The temporary tokenizer policy is intentionally conservative:

```text
ceil((chars / 3.3) * 1.35)
```

This estimate is not a billing tokenizer. It is a runtime safety estimate for warning, seam, and UI decisions.

## History Retention

Runtime history should be model-aware:

- Recent turns are preserved verbatim, with the default verbatim window set to 16 turns.
- Older turns can enter semantic summary when compression is enabled.
- The old defaults of 24 messages and 32,000 characters are not used for DeepSeek V4 default history.
- Explicit small `maxInputTokens` overrides still force trimming for tests and constrained requests.
- UI transcript rendering is separate from model context construction; a long visible conversation does not mean every raw event is reinserted into the next model request.

## Tool Output Routing

Tool output is useful evidence, but raw output can pollute long-context prompts. SeekForge routes tool results by type:

- Shell output uses a low inline limit and should summarize large logs.
- Search, grep, web, and MCP results use medium inline limits because their snippets often guide the next action.
- Large artifacts are stored out-of-band. Later context keeps artifact id, path, and summary unless raw content is explicitly promoted.
- Diff and generated artifact bodies should not be repeatedly rehydrated into history.

The goal is to keep evidence available without letting one verbose command dominate the 1M window.

## Reasoning Replay

DeepSeek thinking with tool calls requires assistant tool-call history to replay matching reasoning content. SeekForge preserves or reconstructs this shape:

- Assistant messages with tool calls keep `toolCalls` plus relevant `reasoningContent`.
- Following tool messages keep matching `tool_call_id` results.
- Historical `reasoning_delta` events are restored into assistant history.
- If legacy saved history lacks reasoning content for a DeepSeek thinking tool-call message, the provider adapter can apply a compatibility placeholder to avoid invalid replay errors.

This is a correctness rule, not a UI feature. It prevents DeepSeek thinking sessions from failing during long-session replay.

## Cache-Aware Prompt Order

SeekForge treats prefix cache as a request-shaping constraint:

1. Fixed core system prompt and workflow rules.
2. Stable tool prefix, sorted by tool name.
3. Stable project snapshot and pinned project context.
4. Conversation ledger and summaries.
5. Dynamic user prompt and one-off context at the end.

Dynamic content should be appended instead of rewriting earlier stable layers. MCP tools, skills, memories, and project deltas should expose stable indexes first and load larger bodies on demand.

## Seam Levels

DeepSeek V4 large-context seams are telemetry thresholds over estimated input tokens:

| Seam | Threshold | Intended behavior |
| --- | ---: | --- |
| `l1` | 192,000 | Warn that the session is entering large-context territory. |
| `l2` | 384,000 | Compress or summarize large tool outputs more aggressively. |
| `l3` | 576,000 | Prefer history compression and working-set summaries. |
| `cycle` | 768,000 | Generate or refresh handoff briefing before continuing complex work. |
| `hard` | about 930,000 | Block or require context reduction before sending. |

Warnings should say "接近输入预算". Critical states should say "需要压缩或减少上下文".

## UI and Telemetry

The context UI should separate current-request pressure from historical usage:

- `estimatedInputTokens / maxInputTokens` drives the context percentage.
- Context window, output reservation, and safety headroom are shown as capacity metadata.
- Cumulative tokens, cache tokens, output tokens, and reasoning tokens are shown separately and do not affect current context percentage.
- Cache-prefix hash, cache break reason, seam level, and coherence state are telemetry aids, not automatic prompt rewrites.

## Verification

Context behavior is protected by tests in `@seekforge/agent-core` and desktop UI tests:

- Model metadata tests cover DeepSeek V4 Pro, Flash, legacy models, suffix parsing, fallback windows, and input budget math.
- Capacity tests cover 1M budgets, output reservation, headroom, tool schemas, tool calls, reasoning content, and prefix hash layers.
- Runtime-history tests cover model-aware history retention, recent-turn preservation, small-budget trimming, tool-result limits, artifact summaries, and reasoning replay.
- Prefix invariant tests cover stable segment hashes and append-only request behavior.
- UI usage tests cover current-request capacity fields and separation from cumulative/cache/reasoning totals.

