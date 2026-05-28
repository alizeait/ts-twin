#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sade from 'sade';
import { findDuplicateFunctions } from './index';
import { formatPreviewSnippet } from './preview';
import type { FunctionOccurrence } from './types';

declare const __VERSION__: string;

type CliOptions = Record<string, unknown>;

type PreviewOptions = {
  color: boolean;
  maxLines: number;
  root: string;
  sources: Map<string, Promise<string>>;
  theme: string;
};

sade('ts-twin [root]', true)
  .version(__VERSION__)
  .describe('Find structurally similar JavaScript and TypeScript functions.')
  .option(
    '--min-score',
    'Similarity threshold (0-1). Practical range: 0.75-0.95.',
    0.82,
  )
  .option('--include-tests', 'Include test, spec, and stories files.')
  .option('--fail-on-duplicates', 'Exit 1 when duplicate groups are found.')
  .option('--json', 'Print JSON report.')
  .option('--preview', 'Print syntax-highlighted source previews.')
  .option('--preview-lines', 'Maximum lines per preview snippet.', 80)
  .option(
    '--preview-theme',
    'Shiki theme for preview snippets.',
    'vitesse-dark',
  )
  .example('--min-score 0.9')
  .example('--preview')
  .example('apps/volvable --include-tests')
  .action((root: string | undefined, options: CliOptions) => {
    run(root, options).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  })
  .parse(process.argv.filter((arg, index) => index < 2 || arg !== '--'));

async function run(root: string | undefined, options: CliOptions) {
  const rootPath = path.resolve(root ?? process.cwd());
  const minScore = readScore(options['min-score']);
  warnIfLooseScore(minScore, Boolean(options.json));
  const report = await findDuplicateFunctions({
    root: rootPath,
    minScore,
    includeTests: options['include-tests'] === true,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    await printReport(report, minScore, readPreviewOptions(options, rootPath));
  }

  if (options['fail-on-duplicates'] && report.groups.length > 0)
    process.exitCode = 1;
  if (report.parseFailures.length > 0) process.exitCode = process.exitCode ?? 2;
}

function readPositiveNumber(value: unknown, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${option} must be a non-negative number`);
  }
  return parsed;
}

function readScore(value: unknown): number {
  const score = readPositiveNumber(value, '--min-score');
  if (score > 1) throw new Error('--min-score must be between 0 and 1');
  return score;
}

function readPreviewOptions(
  options: CliOptions,
  root: string,
): PreviewOptions | undefined {
  if (options.preview !== true) return undefined;
  return {
    color: Boolean(process.stdout.isTTY),
    maxLines: readPositiveInteger(options['preview-lines'], '--preview-lines'),
    root,
    sources: new Map(),
    theme: readString(options['preview-theme'], '--preview-theme'),
  };
}

function readPositiveInteger(value: unknown, option: string): number {
  const parsed = readPositiveNumber(value, option);
  if (!Number.isInteger(parsed) || parsed === 0) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}

function readString(value: unknown, option: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${option} must be a non-empty string`);
  }
  return value;
}

function warnIfLooseScore(minScore: number, json: boolean) {
  if (json || minScore >= 0.6) return;
  console.warn(
    `ts-twin: warning: min-score=${minScore} is very loose; practical values are usually 0.75-0.95`,
  );
}

/**
 * Human + agent friendly report.
 *
 * Format is designed for AI agents that read tool output and act on it:
 *  - Each occurrence is emitted as `file:line:col: name` (GCC/clang/ESLint/
 *    Ruff convention) so editor "jump to source" and grep both work.
 *  - Each group is introduced by a `[N]` index line; blank line separates
 *    groups. Groups are sorted by descending score, so the most certain
 *    duplicates appear first.
 *  - Status and hint lines are prefixed with `ts-twin:` for greppability,
 *    and the hint is shown once at the top, not repeated per group.
 */
async function printReport(
  report: Awaited<ReturnType<typeof findDuplicateFunctions>>,
  minScore: number,
  preview: PreviewOptions | undefined,
) {
  const files = report.files.toLocaleString('en-US');
  const functions = report.functions.toLocaleString('en-US');
  console.log(`ts-twin: scanned ${files} files (${functions} functions)`);

  if (report.parseFailures.length > 0) {
    console.log('');
    console.log(
      `ts-twin: ${report.parseFailures.length} file(s) skipped due to parse errors`,
    );
    for (const failure of report.parseFailures) {
      console.log(`  ${failure.file}: ${failure.message}`);
    }
  }

  if (report.groups.length === 0) {
    console.log(`ts-twin: no duplicate groups found at min-score=${minScore}`);
    return;
  }

  console.log('');
  console.log(
    `ts-twin: found ${report.groups.length} duplicate group(s) at min-score=${minScore}`,
  );
  console.log(
    'ts-twin: extract shared logic when it improves readability, or add `// ts-twin-ignore: <reason>` when duplication is intentional',
  );

  for (const [index, group] of report.groups.entries()) {
    console.log('');
    console.log(`[${index + 1}]`);
    for (const item of group.functions) {
      console.log(`  ${item.file}:${item.line}:1: ${item.name}`);
      if (preview) await printPreview(item, preview);
    }
  }

  const totalFunctions = report.groups.reduce(
    (total, group) => total + group.functions.length,
    0,
  );
  console.log('');
  console.log(
    `ts-twin: ${report.groups.length} group(s), ${totalFunctions} duplicate function(s)`,
  );
}

async function printPreview(item: FunctionOccurrence, options: PreviewOptions) {
  try {
    const source = await readPreviewSource(item.file, options);
    const snippet = source.slice(item.start, item.end);
    if (snippet.trim() === '') return;

    console.log(
      await formatPreviewSnippet(item.file, snippet, {
        color: options.color,
        maxLines: options.maxLines,
        theme: options.theme,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`    preview unavailable: ${message}`);
  }
}

async function readPreviewSource(
  file: string,
  options: PreviewOptions,
): Promise<string> {
  const existing = options.sources.get(file);
  if (existing) return existing;

  const absolute = path.isAbsolute(file) ? file : path.join(options.root, file);
  const source = readFile(absolute, 'utf8');
  options.sources.set(file, source);
  return source;
}
