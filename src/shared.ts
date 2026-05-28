import path from 'node:path';
import type { AstRecord, LanguageFamily } from './types';

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
]);
export const IGNORED_DIRS = new Set([
  '.cache',
  '.git',
  '.next',
  '.output',
  '.parcel-cache',
  '.pnpm-store',
  '.turbo',
  '.vercel',
  '.vite',
  '.yarn',
  'build',
  'coverage',
  'dist',
  'generated',
  'logs',
  'node_modules',
  'out',
  'playwright-report',
  'reports',
  'storybook-static',
  'test-results',
  'tmp',
  '__generated__',
]);
export const SKIP_KEYS = new Set([
  'accessibility',
  'comments',
  'declare',
  'end',
  'hashbang',
  'innerComments',
  'leadingComments',
  'loc',
  'optional',
  'range',
  'returnType',
  'span',
  'start',
  'trailingComments',
  'typeAnnotation',
  'typeArguments',
  'typeParameters',
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isAstRecord(value: unknown): value is AstRecord {
  return isRecord(value) && typeof value.type === 'string';
}

export function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function shouldScanFile(file: string, includeTests = false): boolean {
  const normalized = normalizePath(file);
  if (/\.d\.[cm]?ts$/u.test(normalized)) return false;
  if (!SOURCE_EXTENSIONS.has(path.extname(normalized))) return false;
  if (
    !includeTests &&
    /(^|[/.])(test|spec|stories)\.[cm]?[jt]sx?$/u.test(normalized)
  ) {
    return false;
  }

  return normalized.split('/').every((part) => !IGNORED_DIRS.has(part));
}

export function getLanguageFamily(file: string): LanguageFamily {
  return path.extname(file).includes('ts') ? 'ts' : 'js';
}

/**
 * Formats a primitive for the canonical token stream. Finite numbers are
 * bucketed by leading digit and order of magnitude, so:
 *  - `0`, `1`, `-1` collapse to fixed tokens (preserves "trivial offset"
 *    grouping — `index + 1` vs `index + 1` still matches verbatim).
 *  - Other values become `number:${firstDigit}e${exp}` (e.g. `1000` -> `1e3`,
 *    `60` -> `6e1`, `0.453` -> `4e-1`).
 *
 * This catches cross-magnitude false positives (`x * 1000` vs `x * 60`,
 * `length > 32` vs `length > 12`) while still grouping
 * `slice(0, 5)` vs `slice(0, 9)` (both bucket as `5e0`/`9e0` — separate, but
 * surrounding shingles still overlap by 4/5).
 */
export function formatPrimitive(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return String(value);
  return typeof value;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return 'number:0';
  if (value === 1 || value === -1) return 'number:unit';

  const magnitude = Math.abs(value);
  const exp = Math.floor(Math.log10(magnitude));
  const leadingDigit = Math.floor(magnitude / Math.pow(10, exp));
  return `number:${leadingDigit}e${exp}`;
}

export function formatParseError(error: unknown): string {
  if (isRecord(error) && typeof error.message === 'string')
    return error.message;
  return String(error);
}

export function normalizePath(file: string): string {
  return file.split(path.sep).join('/');
}
