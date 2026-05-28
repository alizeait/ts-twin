#!/usr/bin/env node
/**
 * Synthetic large-corpus benchmark for ts-twin.
 *
 * Generates a configurable number of TypeScript-ish source files containing
 * non-trivial functions with some intentionally duplicated structures, then
 * times the end-to-end `findDuplicateFunctionsInSources` call.
 *
 * Run after `pnpm build`:
 *
 *   node bench/bench.mjs [functionCount]
 *
 * Default function count: 2000.
 */
import { performance } from 'node:perf_hooks';
import { parseSync } from 'oxc-parser';
import { findDuplicateFunctionsInSources } from '../dist/index.js';
import { generateCorpus } from './_corpus.mjs';

const requested = Number(process.argv[2] ?? 2000);
const functionCount = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 2000;
const mode = process.argv[3] === 'realistic' ? 'realistic' : 'templated';

const sources = generateCorpus(functionCount, mode);
console.log(`mode: ${mode}`);

// Warm-up so the very first call doesn't dominate the timing.
findDuplicateFunctionsInSources(sources.slice(0, Math.min(64, sources.length)));

const runs = 3;
const samples = [];
let lastReport;
for (let i = 0; i < runs; i += 1) {
  const start = performance.now();
  lastReport = findDuplicateFunctionsInSources(sources);
  samples.push(performance.now() - start);
}

// Isolated parse-only run so we know how much of the wall time is oxc-parser
// (which we cannot optimize without going to worker threads).
const parseStart = performance.now();
for (const source of sources) {
  parseSync(source.file, source.source, { astType: 'ts', range: true });
}
const parseElapsed = performance.now() - parseStart;

samples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)];
const best = samples[0];
const worst = samples[samples.length - 1];
const algorithmOnly = median - parseElapsed;

console.log(`ts-twin bench`);
console.log(`  sources:                 ${sources.length}`);
console.log(`  candidates:              ${lastReport.functions}`);
console.log(`  groups found:            ${lastReport.groups.length}`);
console.log(`  runs:                    ${runs}`);
console.log(`  best:                    ${best.toFixed(1)} ms`);
console.log(`  median:                  ${median.toFixed(1)} ms`);
console.log(`  worst:                   ${worst.toFixed(1)} ms`);
console.log(`  parseSync (isolated):    ${parseElapsed.toFixed(1)} ms`);
console.log(`  algorithm (median-parse):${algorithmOnly.toFixed(1)} ms`);
console.log(`  candidates/sec:          ${(lastReport.functions / (median / 1000)).toFixed(0)}`);

