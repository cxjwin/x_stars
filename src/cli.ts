#!/usr/bin/env node
import { authorizeWithPkce } from './auth.js';
import { loadEnv, requiredEnv } from './env.js';
import { exportWithApi } from './providers/api.js';
import type { ExportKind, ExportResult, ProgressEvent } from './types.js';
import { writeExport } from './writer.js';

type KindArg = ExportKind | 'all';

interface CliOptions {
  command: 'auth' | 'export' | 'test-live' | 'browser-fallback' | 'help';
  kind: KindArg;
  maxPages?: number;
  outputDir: string;
  limit?: number;
  clientId?: string;
  clientSecret?: string;
  callbackUrl?: string;
  noOpen: boolean;
}

loadEnv();

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === 'help') {
    printHelp();
    return;
  }

  if (options.command === 'browser-fallback') {
    printBrowserFallback();
    return;
  }

  if (options.command === 'auth') {
    await authorizeWithPkce({
      clientId: options.clientId ?? requiredEnv('X_CLIENT_ID'),
      clientSecret: options.clientSecret ?? process.env.X_CLIENT_SECRET,
      callbackUrl: options.callbackUrl,
      openBrowser: !options.noOpen
    });
    return;
  }

  if (options.command === 'test-live') {
    options.limit = 1;
    options.outputDir = '';
  }

  const kinds = options.kind === 'all' ? ['bookmarks', 'likes'] as const : [options.kind];
  for (const kind of kinds) {
    const result = await runExport({ ...options, kind });
    printSummary(result);
    if (options.command === 'export') {
      const outputPath = await writeExport(result, options.outputDir);
      console.log(`Saved ${kind} export to ${outputPath}`);
    }
  }
}

async function runExport(options: CliOptions & { kind: ExportKind }): Promise<ExportResult> {
  const onProgress = (event: ProgressEvent) => console.log(`[${event.source}:${event.kind}] ${event.message}`);

  return exportWithApi({
    kind: options.kind,
    userId: requiredEnv('X_USER_ID'),
    token: requiredEnv('X_USER_ACCESS_TOKEN'),
    maxPages: options.maxPages,
    maxItems: options.limit,
    onProgress
  });
}

function parseArgs(args: string[]): CliOptions {
  const command = (args[0] ?? 'help') as CliOptions['command'];
  const values = parseKeyValues(args.slice(1));

  if (!['auth', 'export', 'test-live', 'browser-fallback', 'help'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  return {
    command,
    kind: parseKind(values.kind ?? 'all'),
    maxPages: parseOptionalNumber(values['max-pages'], '--max-pages'),
    outputDir: values['output-dir'] ?? 'exports',
    limit: parseOptionalNumber(values.limit, '--limit'),
    clientId: values['client-id'],
    clientSecret: values['client-secret'],
    callbackUrl: values['callback-url'],
    noOpen: values.open === 'false' || values['no-open'] === 'true'
  };
}

function parseKeyValues(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg?.startsWith('--')) continue;

    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');
    if (equalsIndex >= 0) {
      parsed[withoutPrefix.slice(0, equalsIndex)] = withoutPrefix.slice(equalsIndex + 1);
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[withoutPrefix] = 'true';
    } else {
      parsed[withoutPrefix] = next;
      index++;
    }
  }

  return parsed;
}

function parseKind(value: string): KindArg {
  if (value === 'bookmarks' || value === 'likes' || value === 'all') return value;
  throw new Error(`Invalid --kind: ${value}. Use bookmarks, likes, or all.`);
}

function parseNumber(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

function parseOptionalNumber(value: string | undefined, name: string): number | undefined {
  return value ? parseNumber(value, 0, name) : undefined;
}

function printSummary(result: ExportResult): void {
  console.log([
    `${result.source}:${result.kind}`,
    `count=${result.totalCount}`,
    `newest=${result.range.newestTweetAt ?? 'n/a'}`,
    `oldest=${result.range.oldestTweetAt ?? 'n/a'}`
  ].join(' '));
}

function printBrowserFallback(): void {
  console.log(`Browser fallback (no Playwright; uses your already-logged-in browser).

This project does not bundle browser automation. Instead, an agent CLI with a
browser debugging tool drives the user's existing browser session:

  - Claude Code: chrome-devtools MCP (list_pages / navigate_page / evaluate_script)
  - Codex: built-in browser tool

The injectable scripts live in scripts/:

  scripts/browser-bookmarks-7d.js
  scripts/browser-likes-7d.js

Manual fallback (no agent): open Chrome, log in to X, open the bookmarks or
likes page, then DevTools Console -> paste the script -> wait for the JSON
download -> move it into exports/browser-current/.

The agent flow does the same thing but automates the paste + scroll loop.
See docs/browser-profile.md for the full procedure.
`);
}

function printHelp(): void {
  console.log(`x-stars

Usage:
  x-stars auth --client-id YOUR_OAUTH2_CLIENT_ID
  x-stars export --kind bookmarks|likes|all --max-pages 10
  x-stars test-live --kind bookmarks|likes|all
  x-stars browser-fallback     # print the DevTools-injection workflow

Options:
  --client-id     OAuth 2.0 client id for auth. Can also use X_CLIENT_ID
  --client-secret OAuth 2.0 client secret for confidential apps. Can also use X_CLIENT_SECRET
  --callback-url  OAuth callback URL. Default: http://127.0.0.1:8787/callback
  --kind          bookmarks, likes, or all
  --max-pages     API pagination page limit
  --output-dir    Export directory. Default: exports
  --limit         Stop after N normalized tweets
  --no-open       Print auth URL without opening the browser
`);
}
