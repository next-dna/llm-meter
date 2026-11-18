#!/usr/bin/env node
/**
 * llm-meter — record LLM token usage and compare latest vs previous.
 *
 * Commands:
 *   record   Log one usage event (explicit counts or piped response JSON).
 *   report   Show latest vs previous token usage per provider + kind.
 */

import * as fs from 'fs';
import * as path from 'path';

import { appendEvent, readEvents } from './store';
import { buildEvent, compareUsage } from './usage';
import { renderUsageReport } from './reporter';

interface ParsedArgs {
  command: string | undefined;
  provider: string | undefined;
  kind: string;
  input: number | undefined;
  output: number | undefined;
  total: number | undefined;
  model: string | undefined;
  file: string | undefined;
  json: boolean;
  help: boolean;
  version: boolean;
}

const USAGE = `
llm-meter — meter LLM token usage across providers

Usage:
  llm-meter <command> [options]

Commands:
  record    Record a usage event (explicit counts or piped response JSON)
  report    Show latest vs previous token usage per provider + kind

Options:
  --provider <name>   Provider (openai|anthropic|gemini|cursor|windsurf|...)
  --kind <name>       Interaction kind (request|ask|plan|agent; default request)
  --input/--output n  Explicit prompt/completion token counts
  --total <n>         Explicit total token count
  --model <name>      Optional model name to tag the event
  --file <path>       Usage file (default ~/.llm-meter/usage.jsonl, or $LLM_METER_USAGE)
  --json              Output machine-readable JSON
  -h, --help          Show this help
  -v, --version       Show version

Examples:
  llm-meter record --provider openai --kind ask --input 1200 --output 340
  echo '{"prompt_tokens":1500,"completion_tokens":500}' | llm-meter record --provider openai --kind agent
  your-anthropic-call | llm-meter record --provider anthropic --kind plan
  llm-meter report
`;

/** Parse a non-negative integer, throwing on an invalid value. */
function parseCount(value: string | undefined, flag: string): number {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`Invalid ${flag} "${value ?? ''}". Expected a non-negative integer.`);
  }
  return n;
}

/** Parse argv into a typed options object. */
export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: undefined,
    provider: undefined,
    kind: 'request',
    input: undefined,
    output: undefined,
    total: undefined,
    model: undefined,
    file: undefined,
    json: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--version':
      case '-v':
        parsed.version = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--provider':
        parsed.provider = argv[++i];
        break;
      case '--kind':
        parsed.kind = argv[++i] ?? parsed.kind;
        break;
      case '--model':
        parsed.model = argv[++i];
        break;
      case '--file':
        parsed.file = argv[++i];
        break;
      case '--input':
        parsed.input = parseCount(argv[++i], '--input');
        break;
      case '--output':
        parsed.output = parseCount(argv[++i], '--output');
        break;
      case '--total':
        parsed.total = parseCount(argv[++i], '--total');
        break;
      default:
        if (arg !== undefined && arg.startsWith('--provider=')) {
          parsed.provider = arg.slice('--provider='.length);
        } else if (arg !== undefined && arg.startsWith('--kind=')) {
          parsed.kind = arg.slice('--kind='.length);
        } else if (arg !== undefined && arg.startsWith('--model=')) {
          parsed.model = arg.slice('--model='.length);
        } else if (arg !== undefined && arg.startsWith('--file=')) {
          parsed.file = arg.slice('--file='.length);
        } else if (arg !== undefined && arg.startsWith('--input=')) {
          parsed.input = parseCount(arg.slice('--input='.length), '--input');
        } else if (arg !== undefined && arg.startsWith('--output=')) {
          parsed.output = parseCount(arg.slice('--output='.length), '--output');
        } else if (arg !== undefined && arg.startsWith('--total=')) {
          parsed.total = parseCount(arg.slice('--total='.length), '--total');
        } else if (arg !== undefined && !arg.startsWith('-') && parsed.command === undefined) {
          parsed.command = arg;
        }
        break;
    }
  }

  return parsed;
}

function readVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Read piped stdin as a string, or '' when nothing is piped. */
function readStdin(): string {
  if (process.stdin.isTTY) {
    return '';
  }
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** `record` — append one usage event from flags and/or piped JSON. */
function runRecord(args: ParsedArgs): number {
  if (!args.provider) {
    process.stderr.write('record: --provider is required (e.g. --provider openai).\n');
    return 1;
  }

  let raw: Record<string, unknown> | undefined;
  const hasExplicit = args.input !== undefined || args.output !== undefined || args.total !== undefined;
  if (!hasExplicit) {
    const piped = readStdin().trim();
    if (piped.length > 0) {
      try {
        const obj = JSON.parse(piped) as Record<string, unknown>;
        // Accept a bare usage object or a full response with a `usage` field.
        raw =
          (obj.usage as Record<string, unknown>) ??
          (obj.usageMetadata as Record<string, unknown>) ??
          obj;
      } catch {
        process.stderr.write('record: piped input was not valid JSON.\n');
        return 1;
      }
    }
  }

  if (!hasExplicit && !raw) {
    process.stderr.write(
      'record: provide --input/--output/--total, or pipe the response usage JSON.\n',
    );
    return 1;
  }

  const event = buildEvent({
    provider: args.provider,
    kind: args.kind,
    ...(args.model ? { model: args.model } : {}),
    ...(args.input !== undefined ? { input: args.input } : {}),
    ...(args.output !== undefined ? { output: args.output } : {}),
    ...(args.total !== undefined ? { total: args.total } : {}),
    ...(raw ? { raw } : {}),
  });

  if (!appendEvent(event, args.file)) {
    process.stderr.write('record: failed to write the usage file.\n');
    return 1;
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(event, null, 2) + '\n');
  } else {
    process.stdout.write(
      `Recorded ${event.provider} ${event.kind}: ${event.totalTokens} tokens ` +
        `(in ${event.inputTokens}, out ${event.outputTokens}).\n`,
    );
  }
  return 0;
}

/** `report` — show latest vs previous usage per provider + kind. */
function runReport(args: ParsedArgs): number {
  let events = readEvents(args.file);
  if (args.provider) {
    events = events.filter((e) => e.provider === args.provider);
  }
  const rows = compareUsage(events);

  if (args.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(renderUsageReport(rows) + '\n');
  return 0;
}

/** Entry point. Returns a process exit code (does not call process.exit). */
export function main(argv: string[] = process.argv.slice(2)): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    return 1;
  }

  if (args.version) {
    process.stdout.write(readVersion() + '\n');
    return 0;
  }

  if (args.help || args.command === undefined) {
    process.stdout.write(USAGE);
    return args.command === undefined && !args.help ? 1 : 0;
  }

  try {
    switch (args.command) {
      case 'record':
        return runRecord(args);
      case 'report':
        return runReport(args);
      default:
        process.stderr.write(`Unknown command: ${args.command}\n`);
        process.stdout.write(USAGE);
        return 1;
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main());
}
