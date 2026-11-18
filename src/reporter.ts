/**
 * Terminal reporter. Uses ANSI escapes directly (no dependencies) and disables
 * color when output is not a TTY or NO_COLOR is set.
 */

import type { UsageComparison } from './types';

const COLOR_ENABLED = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

function paint(code: keyof typeof CODES, text: string): string {
  return COLOR_ENABLED ? `${CODES[code]}${text}${CODES.reset}` : text;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function heading(text: string): string {
  return paint('cyan', paint('bold', `\n${text}`));
}

/** Plain text + color token for a signed delta (padded by the caller). */
function deltaCell(delta: number | null): { text: string; color: keyof typeof CODES } {
  if (delta === null) {
    return { text: '—', color: 'gray' };
  }
  if (delta === 0) {
    return { text: '0', color: 'gray' };
  }
  // Fewer tokens than last time is an improvement.
  return {
    text: `${delta > 0 ? '+' : '−'}${formatNumber(Math.abs(delta))}`,
    color: delta > 0 ? 'yellow' : 'green',
  };
}

/** Render the latest-vs-previous token usage table. */
export function renderUsageReport(rows: UsageComparison[]): string {
  const lines: string[] = [];
  lines.push(heading('LLM token usage — latest vs previous'));

  if (rows.length === 0) {
    lines.push(paint('gray', '  No usage recorded yet. Record with `llm-meter record`.'));
    return lines.join('\n');
  }

  const provWidth = Math.max(8, ...rows.map((r) => r.provider.length));
  const kindWidth = Math.max(4, ...rows.map((r) => r.kind.length));
  lines.push(
    '  ' +
      paint(
        'dim',
        pad('PROVIDER', provWidth) +
          '  ' +
          pad('KIND', kindWidth) +
          '  ' +
          pad('LATEST', 9) +
          '  ' +
          pad('PREVIOUS', 9) +
          '  ' +
          pad('CHANGE', 9) +
          '  ' +
          pad('RUNS', 5) +
          '  LIFETIME',
      ),
  );
  for (const r of rows) {
    const d = deltaCell(r.delta);
    lines.push(
      '  ' +
        pad(r.provider, provWidth) +
        '  ' +
        pad(r.kind, kindWidth) +
        '  ' +
        pad(formatNumber(r.latest), 9) +
        '  ' +
        pad(r.previous === null ? '—' : formatNumber(r.previous), 9) +
        '  ' +
        paint(d.color, pad(d.text, 9)) +
        '  ' +
        pad(formatNumber(r.count), 5) +
        '  ' +
        paint('gray', formatNumber(r.lifetime)),
    );
  }
  return lines.join('\n');
}
