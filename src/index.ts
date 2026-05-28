import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseSync } from 'oxc-parser';
import { extractFunctions } from './ast';
import { listFiles } from './files';
import {
  formatParseError,
  isRecord,
  normalizePath,
  shouldScanFile,
} from './shared';
import { groupDuplicates } from './similarity';
import type {
  AnalyzeOptions,
  Candidate,
  DuplicateOptions,
  DuplicateReport,
  ParseFailure,
  SourceComment,
  SourceFile,
} from './types';

export type {
  DuplicateGroup,
  DuplicateOptions,
  DuplicateReport,
  FunctionOccurrence,
  ParseFailure,
  SourceFile,
} from './types';

const DEFAULT_MIN_SCORE = 0.82;
const DEFAULT_MIN_NODES = 12;
const DEFAULT_MIN_TOKENS = 30;

export async function findDuplicateFunctions(
  options: DuplicateOptions = {},
): Promise<DuplicateReport> {
  const root = path.resolve(options.root ?? process.cwd());
  const files = options.files ?? (await listFiles(root, options.includeTests));
  const sources = await Promise.all(
    files.map((file) => readSource(root, file)),
  );

  return findDuplicateFunctionsInSources(sources, options);
}

export function findDuplicateFunctionsInSources(
  sources: SourceFile[],
  options: AnalyzeOptions = {},
): DuplicateReport {
  const profile = Boolean(process.env.TS_TWIN_PROFILE);
  const parseFailures: ParseFailure[] = [];

  const candStart = profile ? performance.now() : 0;
  const candidates = getCandidates(sources, options, parseFailures);
  const candElapsed = profile ? performance.now() - candStart : 0;

  const groupStart = profile ? performance.now() : 0;
  const groups = groupDuplicates(
    candidates,
    options.minScore ?? DEFAULT_MIN_SCORE,
  );
  const groupElapsed = profile ? performance.now() - groupStart : 0;

  if (profile) {
    process.stderr.write(
      `ts-twin profile: getCandidates=${candElapsed.toFixed(1)}ms ` +
        `groupDuplicates=${groupElapsed.toFixed(1)}ms ` +
        `candidates=${candidates.length}\n`,
    );
  }

  return {
    files: sources.length,
    functions: candidates.length,
    groups,
    parseFailures,
  };
}

async function readSource(root: string, file: string): Promise<SourceFile> {
  const absolute = path.isAbsolute(file) ? file : path.join(root, file);
  return {
    file: normalizePath(
      path.isAbsolute(file) ? path.relative(root, file) : file,
    ),
    source: await readFile(absolute, 'utf8'),
  };
}

function getCandidates(
  sources: SourceFile[],
  options: AnalyzeOptions,
  failures: ParseFailure[],
): Candidate[] {
  const minNodes = options.minNodes ?? DEFAULT_MIN_NODES;
  const minTokens = options.minTokens ?? DEFAULT_MIN_TOKENS;
  const candidates: Candidate[] = [];

  for (const source of sources) {
    for (const candidate of readCandidates(
      source,
      options,
      failures,
      minNodes,
      minTokens,
    )) {
      candidates.push(candidate);
    }
  }

  return candidates.map((candidate, id) => ({ ...candidate, id }));
}

function readCandidates(
  source: SourceFile,
  options: AnalyzeOptions,
  failures: ParseFailure[],
  minNodes: number,
  minTokens: number,
): Candidate[] {
  if (!shouldScanFile(source.file, options.includeTests)) return [];

  try {
    const result = parseSync(source.file, source.source, {
      astType: 'ts',
      range: true,
    });

    if (result.errors.length > 0) {
      failures.push({
        file: source.file,
        message: formatParseError(result.errors[0]),
      });
      return [];
    }

    return extractFunctions(
      result.program as unknown,
      source.file,
      source.source,
      getComments(result.comments as unknown),
    )
      .filter((candidate) => candidate.nodes >= minNodes)
      .filter((candidate) => candidate.tokens >= minTokens);
  } catch (error) {
    failures.push({ file: source.file, message: formatParseError(error) });
    return [];
  }
}

function getComments(comments: unknown): SourceComment[] {
  if (!Array.isArray(comments)) return [];
  return comments.flatMap((comment) => {
    const parsed = getComment(comment);
    return parsed ? [parsed] : [];
  });
}

function getComment(comment: unknown): SourceComment | undefined {
  if (!isRecord(comment)) return undefined;

  const range = readRange(comment);
  const value = readCommentValue(comment);
  return range && value !== undefined
    ? { start: range[0], end: range[1], value }
    : undefined;
}

function readRange(
  comment: Record<string, unknown>,
): [number, number] | undefined {
  if (
    Array.isArray(comment.range) &&
    typeof comment.range[0] === 'number' &&
    typeof comment.range[1] === 'number'
  ) {
    return [comment.range[0], comment.range[1]];
  }

  if (typeof comment.start === 'number' && typeof comment.end === 'number') {
    return [comment.start, comment.end];
  }

  if (
    isRecord(comment.span) &&
    typeof comment.span.start === 'number' &&
    typeof comment.span.end === 'number'
  ) {
    return [comment.span.start, comment.span.end];
  }

  return undefined;
}

function readCommentValue(
  comment: Record<string, unknown>,
): string | undefined {
  if (typeof comment.value === 'string') return comment.value;
  if (typeof comment.content === 'string') return comment.content;
  return undefined;
}
