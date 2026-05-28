# ts-twin

Find structurally similar JavaScript and TypeScript functions.

`ts-twin` parses source files, extracts function bodies, and compares their AST
structure using [TF-IDF](https://en.wikipedia.org/wiki/Tf%E2%80%93idf) weighted
shingles. It is designed to find near-duplicate functions even when names,
formatting, and small implementation details differ.

## Purpose

Most copy-paste detectors report duplicated text ranges. That is useful for
finding repeated blocks, but it often misses a different refactoring signal:
separate functions that have the same structure after identifiers and local
details are normalized.

`ts-twin` focuses on that case. It reports groups of related functions, not raw
line ranges, so the output is aimed at code review, refactoring, and automated
maintenance workflows.

Not every match should become an abstraction. In those
cases, extract only the shared logic when it improves readability, or suppress
the function with `// ts-twin-ignore: <reason>`.

## Comparison

Unlike text-based clone detectors such as
[`jscpd`](https://github.com/kucherenko/jscpd), `ts-twin` focuses specifically
on structurally similar JavaScript and TypeScript functions.

## Features

- Structural comparison based on AST shape rather than text.
- Identifier normalization for parameters and local variables.
- TF-IDF weighting so common boilerplate contributes less to the score.
- Fast parsing through [oxc-parser](https://www.npmjs.com/package/oxc-parser).
- Inline suppression with `// ts-twin-ignore: <reason>`.

## Installation


```bash
yarn add -D ts-twin
pnpm add -D ts-twin
npm install -D ts-twin
```

or run with `npx` without installing:

```bash
npx ts-twin
```

## CLI

```txt
Description
  Find structurally similar JavaScript and TypeScript functions.

Usage
  $ ts-twin [root] [options]

Options
  --min-score             Similarity threshold (0-1). Practical range: 0.75-0.95.  (default 0.82)
  --include-tests         Include test, spec, and stories files.
  --fail-on-duplicates    Exit 1 when duplicate groups are found.
  --json                  Print JSON report.
  --preview               Print syntax-highlighted source previews.
  --preview-lines         Maximum lines per preview snippet.  (default 80)
  --preview-theme         Shiki theme for preview snippets.  (default vitesse-dark)
  -v, --version           Displays current version
  -h, --help              Displays this message

Examples
  $ ts-twin --min-score 0.9
  $ ts-twin --preview
  $ ts-twin apps/volvable --include-tests
```

Preview mode is intended for local terminal use. It keeps the normal match
summary, then prints the matched function bodies below each location. When
stdout is not a TTY, snippets are printed without ANSI colors.

## Library API

```typescript
import {
  findDuplicateFunctions,
  findDuplicateFunctionsInSources,
} from 'ts-twin';

const diskReport = await findDuplicateFunctions({
  root: './src',
  minScore: 0.85,
});

const sourceReport = findDuplicateFunctionsInSources([
  { file: 'a.ts', source: 'export function foo() { ... }' },
  { file: 'b.ts', source: 'export function bar() { ... }' },
]);

for (const group of diskReport.groups) {
  console.log(`Score: ${group.score.toFixed(2)}`);
  for (const fn of group.functions) {
    console.log(`  ${fn.file}:${fn.line} ${fn.name}`);
  }
}
```

## Suppression

Add a `ts-twin-ignore:` comment above or inside a function to exclude it from
the report.

```typescript
// ts-twin-ignore: intentionally duplicated for performance
export function fastPath(value: string) {
  // ...
}
```

## How It Works

1. Source files are parsed with `oxc-parser`.
2. Function bodies are encoded into canonical token streams.
3. Parameters and local identifiers are normalized.
4. Token streams are converted into overlapping 5-gram shingles.
5. Shingles are weighted with TF-IDF.
6. Candidate functions are compared with weighted Jaccard similarity.
7. Similar functions are grouped with union-find.


### Performance benchmarks

Recent synthetic benchmark results:

| Corpus | Functions | Median time | Throughput |
|---|---:|---:|---:|
| Templated | 500 | 294 ms | 1,703 functions/s |
| Templated | 2,000 | 1.56 s | 1,282 functions/s |
| Templated | 5,000 | 6.18 s | 809 functions/s |
| Templated | 10,000 | 18.8 s | 532 functions/s |

The templated corpus is intentionally repetitive, so it stresses the duplicate
comparison phase more than a typical mixed codebase.

## License

MIT
