export type AstRecord = Record<string, unknown> & { type: string };

export type SourceFile = {
  file: string;
  source: string;
};

export type FunctionOccurrence = {
  id: number;
  file: string;
  line: number;
  start: number;
  end: number;
  name: string;
  nodes: number;
  tokens: number;
};

export type LanguageFamily = 'js' | 'ts';

export type DuplicateGroup = {
  score: number;
  functions: FunctionOccurrence[];
};

export type ParseFailure = {
  file: string;
  message: string;
};

export type DuplicateReport = {
  files: number;
  functions: number;
  groups: DuplicateGroup[];
  parseFailures: ParseFailure[];
};

export type DuplicateOptions = {
  root?: string;
  files?: string[];
  minScore?: number;
  minNodes?: number;
  minTokens?: number;
  includeTests?: boolean;
};

export type AnalyzeOptions = Pick<
  DuplicateOptions,
  'includeTests' | 'minNodes' | 'minScore' | 'minTokens'
>;

/**
 * Shingle IDs are 53-bit integers (packed dual-hash) so they pack densely
 * into number-keyed maps and numeric arrays.
 */
export type ShingleId = number;

/**
 * Candidate shingles are stored as two parallel arrays sorted ascending by
 * `shingleIds[i]`. This lets `getSharedEvidence` use a two-pointer linear
 * merge — no `Map.get` lookups during pair comparison — which is the
 * dominant hot path for large codebases.
 */
export type Candidate = FunctionOccurrence & {
  language: LanguageFamily;
  shingleIds: number[];
  shingleCounts: number[];
};

export type SourceComment = {
  start: number;
  end: number;
  value: string;
};
