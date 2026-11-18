/** Shared types for llm-meter. */

/** A single recorded LLM token-usage event. */
export interface UsageEvent {
  /** ISO 8601 timestamp of when the usage occurred/was recorded. */
  ts: string;
  /** Provider label, e.g. "openai", "anthropic", "gemini", "cursor". */
  provider: string;
  /** Interaction kind, e.g. "request", "ask", "plan", "agent". */
  kind: string;
  /** Prompt / input tokens. */
  inputTokens: number;
  /** Completion / output tokens. */
  outputTokens: number;
  /** Total tokens (input + output unless the provider reports its own total). */
  totalTokens: number;
  /** Optional model name. */
  model?: string;
}

/** Latest-vs-previous usage for one provider + kind pairing. */
export interface UsageComparison {
  provider: string;
  kind: string;
  /** Total tokens of the most recent event. */
  latest: number;
  /** Total tokens of the event before it, or null when there is only one. */
  previous: number | null;
  /** latest - previous, or null when there is no previous event. */
  delta: number | null;
  /** How many events are recorded for this provider+kind. */
  count: number;
  /** Sum of all totals recorded for this provider+kind. */
  lifetime: number;
}
