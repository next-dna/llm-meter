/**
 * LLM token-usage event store.
 *
 * Persists {@link UsageEvent} records as append-only JSONL (one JSON object per
 * line). Zero runtime dependencies: `fs`, `os`, `path` only.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { UsageEvent } from './types';

/**
 * Resolve the usage file path.
 *
 * Precedence: explicit `custom` (`--file`), then `LLM_METER_USAGE`, then
 * `~/.llm-meter/usage.jsonl`.
 */
export function getUsagePath(custom?: string): string {
  if (custom && custom.length > 0) {
    return path.resolve(custom);
  }
  const fromEnv = process.env.LLM_METER_USAGE;
  if (fromEnv && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }
  return path.join(os.homedir(), '.llm-meter', 'usage.jsonl');
}

/** Append a usage event as a JSONL line. Returns false on any write failure. */
export function appendEvent(event: UsageEvent, custom?: string): boolean {
  try {
    const file = getUsagePath(custom);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Read all usage events. Missing file -> empty array; malformed lines skipped.
 */
export function readEvents(custom?: string): UsageEvent[] {
  const file = getUsagePath(custom);
  let contents: string;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new Error(`Unable to read usage at ${file}: ${(err as Error).message}`);
  }

  const events: UsageEvent[] = [];
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const obj = JSON.parse(trimmed) as Partial<UsageEvent>;
      if (
        typeof obj.ts === 'string' &&
        typeof obj.provider === 'string' &&
        typeof obj.totalTokens === 'number'
      ) {
        events.push({
          ts: obj.ts,
          provider: obj.provider,
          kind: typeof obj.kind === 'string' ? obj.kind : 'request',
          inputTokens: typeof obj.inputTokens === 'number' ? obj.inputTokens : 0,
          outputTokens: typeof obj.outputTokens === 'number' ? obj.outputTokens : 0,
          totalTokens: obj.totalTokens,
          ...(typeof obj.model === 'string' ? { model: obj.model } : {}),
        });
      }
    } catch {
      // Skip malformed line.
    }
  }
  return events;
}
