import { collectParamNames, collectPatternNames } from './patterns';
import {
  formatPrimitive,
  getLanguageFamily,
  isAstRecord,
  isRecord,
  readArray,
  SKIP_KEYS,
} from './shared';
import {
  isTrivialCallAdapter,
  isTrivialJsxWrapper,
  isTrivialValueBuilder,
} from './trivial';
import type { AstRecord, Candidate, ShingleId, SourceComment } from './types';

const IGNORE_COMMENT = 'ts-twin-ignore:';

const SHINGLE_SIZE = 5;

type Context = {
  bindings: Map<string, string>;
};

export function extractFunctions(
  ast: unknown,
  file: string,
  source: string,
  comments: SourceComment[] = [],
): Candidate[] {
  const candidates: Candidate[] = [];
  const lineIndex = buildLineIndex(source);

  visit(ast, undefined, (node, parent): boolean | undefined => {
    if (!isFunctionNode(node) || !isRecord(node.body)) return;

    const name = getFunctionName(node, parent);
    if (shouldSkipFunctionName(name)) return;
    if (hasIgnoreComment(node, parent, lineIndex, comments)) return;
    if (
      isTrivialValueBuilder(node) ||
      isTrivialJsxWrapper(node) ||
      isTrivialCallAdapter(node)
    ) {
      return;
    }

    const tokens = tokenizeFunction(node);
    const { shingleIds, shingleCounts } = buildShingleVectors(tokens);
    const range = getNodeRange(node, parent);
    const start = range?.[0] ?? getRangeStart(node) ?? 0;
    candidates.push({
      id: candidates.length,
      file,
      language: getLanguageFamily(file),
      line: getLine(node, lineIndex, start),
      start,
      end: range?.[1] ?? start,
      name,
      nodes: countNodeTokens(tokens),
      tokens: tokens.length,
      shingleIds,
      shingleCounts,
    });

    return undefined;
  });

  return candidates;
}

function tokenizeFunction(node: AstRecord): string[] {
  const context = createContext(node);
  const tokens: string[] = [];
  encodeFunction(node, context, tokens);
  return tokens;
}

function createContext(node: AstRecord): Context {
  const bindings = new Map<string, string>();

  for (const name of collectParamNames(node)) {
    if (!bindings.has(name)) bindings.set(name, `param${bindings.size}`);
  }

  let local = 0;
  for (const name of collectLocalNames(node)) {
    if (!bindings.has(name)) {
      bindings.set(name, `local${local}`);
      local += 1;
    }
  }

  return { bindings };
}

function collectLocalNames(node: AstRecord): string[] {
  const names: string[] = [];

  visit(node.body, undefined, (child) => {
    if (child !== node.body && isFunctionNode(child)) return false;
    if (child.type === 'VariableDeclarator')
      collectPatternNames(child.id, names);
    if (child.type === 'CatchClause') collectPatternNames(child.param, names);
    collectDeclarationName(child, names);
    return true;
  });

  return names;
}

function collectDeclarationName(node: AstRecord, names: string[]) {
  if (node.type !== 'ClassDeclaration' && node.type !== 'FunctionDeclaration')
    return;
  if (isRecord(node.id) && typeof node.id.name === 'string')
    names.push(node.id.name);
}

function encodeFunction(node: AstRecord, context: Context, tokens: string[]) {
  tokens.push('Function');
  tokens.push(`async:${Boolean(node.async)}`);
  tokens.push(`generator:${Boolean(node.generator)}`);
  tokens.push(`params:${readArray(node.params).length}`);
  for (const param of readArray(node.params))
    encodeValue(param, context, tokens);
  encodeValue(node.body, context, tokens);
  tokens.push('/Function');
}

function encodeValue(value: unknown, context: Context, tokens: string[]) {
  if (Array.isArray(value)) {
    encodeArray(value, context, tokens);
    return;
  }

  if (!isAstRecord(value)) {
    tokens.push(isRecord(value) ? 'Object' : formatPrimitive(value));
    return;
  }

  if (encodeSpecialNode(value, context, tokens)) return;
  encodeGenericNode(value, context, tokens);
}

function encodeArray(values: unknown[], context: Context, tokens: string[]) {
  tokens.push('[');
  for (const value of values) encodeValue(value, context, tokens);
  tokens.push(']');
}

function encodeSpecialNode(
  node: AstRecord,
  context: Context,
  tokens: string[],
): boolean {
  switch (node.type) {
    case 'Identifier':
      tokens.push(`Identifier:${normalizeIdentifier(node, context)}`);
      return true;
    case 'Literal':
      tokens.push(`Literal:${formatLiteral(node)}`);
      return true;
    case 'TemplateElement':
      encodeTemplateElement(node, tokens);
      return true;
    case 'PrivateIdentifier':
      tokens.push(`PrivateIdentifier:${String(node.name)}`);
      return true;
    case 'MemberExpression':
      encodeMemberExpression(node, context, tokens);
      return true;
    case 'Property':
    case 'PropertyDefinition':
      encodeProperty(node, context, tokens);
      return true;
    default:
      if (!isFunctionNode(node)) return false;
      encodeFunction(node, context, tokens);
      return true;
  }
}

function encodeGenericNode(
  node: AstRecord,
  context: Context,
  tokens: string[],
) {
  tokens.push(node.type);
  for (const key in node) {
    if (key === 'type' || SKIP_KEYS.has(key)) continue;
    tokens.push(key);
    encodeValue(node[key], context, tokens);
  }
  tokens.push(`/${node.type}`);
}

function encodeMemberExpression(
  node: AstRecord,
  context: Context,
  tokens: string[],
) {
  tokens.push('MemberExpression');
  tokens.push(`computed:${Boolean(node.computed)}`);
  encodeValue(node.object, context, tokens);

  if (
    !node.computed &&
    isRecord(node.property) &&
    typeof node.property.name === 'string'
  ) {
    tokens.push(`property:${node.property.name}`);
  } else {
    encodeValue(node.property, context, tokens);
  }

  tokens.push('/MemberExpression');
}

function encodeProperty(node: AstRecord, context: Context, tokens: string[]) {
  tokens.push(node.type);
  tokens.push(`computed:${Boolean(node.computed)}`);
  if (!node.computed && isRecord(node.key)) {
    tokens.push(`key:${getKeyName(node.key)}`);
  } else {
    encodeValue(node.key, context, tokens);
  }
  encodeValue(node.value, context, tokens);
  tokens.push(`/${node.type}`);
}

function normalizeIdentifier(node: AstRecord, context: Context): string {
  if (typeof node.name !== 'string') return 'unknown';
  return context.bindings.get(node.name) ?? node.name;
}

function formatLiteral(node: AstRecord): string {
  if (
    isRecord(node.regex) &&
    typeof node.regex.pattern === 'string' &&
    typeof node.regex.flags === 'string'
  ) {
    return `/${node.regex.pattern}/${node.regex.flags}`;
  }

  return formatPrimitive(node.value);
}

function encodeTemplateElement(node: AstRecord, tokens: string[]) {
  tokens.push('TemplateElement');
  tokens.push(`raw:${getTemplateRaw(node.value)}`);
  tokens.push(`tail:${Boolean(node.tail)}`);
  tokens.push('/TemplateElement');
}

function getTemplateRaw(value: unknown): string {
  return isRecord(value) && typeof value.raw === 'string'
    ? JSON.stringify(value.raw)
    : 'unknown';
}

/**
 * Builds the candidate's shingle multiset as two parallel arrays
 * (`shingleIds`, `shingleCounts`) sorted ascending by id.
 *
 * Sorting up-front is what makes `getSharedEvidence` an O(|L| + |R|)
 * two-pointer merge in the similarity hot path — no Map lookups required.
 */
function buildShingleVectors(tokens: string[]): {
  shingleIds: number[];
  shingleCounts: number[];
} {
  if (tokens.length === 0) return { shingleIds: [], shingleCounts: [] };

  const counts = new Map<ShingleId, number>();
  if (tokens.length <= SHINGLE_SIZE) {
    counts.set(hashShingle(tokens, 0, tokens.length), 1);
  } else {
    const end = tokens.length - SHINGLE_SIZE;
    for (let start = 0; start <= end; start += 1) {
      const id = hashShingle(tokens, start, SHINGLE_SIZE);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  const shingleIds = [...counts.keys()].sort((a, b) => a - b);
  const shingleCounts: number[] = Array.from({ length: shingleIds.length });
  for (let i = 0; i < shingleIds.length; i += 1) {
    shingleCounts[i] = counts.get(shingleIds[i]) as number;
  }
  return { shingleIds, shingleCounts };
}

/**
 * Hashes `tokens[start .. start + size]` into a 53-bit shingle ID using a
 * dual-hash (DJB2 + FNV-1a). Inlined deliberately so no `tokens.slice` or
 * `tokens.join('\0')` allocation happens per shingle — both of which previously
 * dominated the hashing phase on large codebases.
 */
function hashShingle(tokens: string[], start: number, size: number): ShingleId {
  let h1 = 5381;
  let h2 = 0x811c9dc5;
  for (let t = 0; t < size; t += 1) {
    const token = tokens[start + t];
    for (let i = 0; i < token.length; i += 1) {
      const c = token.charCodeAt(i);
      h1 = (h1 * 33) ^ c;
      h2 = Math.imul(h2 ^ c, 0x01000193);
    }
    // Token boundary marker — preserves the old "join('\0')" semantics so two
    // adjacent token streams `['ab', 'c']` and `['a', 'bc']` hash differently.
    h1 = h1 * 33;
    h2 = Math.imul(h2, 0x01000193);
  }
  // Pack into a 53-bit safe integer: top 21 bits from h1, bottom 32 from h2.
  return (h1 >>> 11) * 0x100000000 + (h2 >>> 0);
}

function visit(
  value: unknown,
  parent: AstRecord | undefined,
  visitor: (
    node: AstRecord,
    parent: AstRecord | undefined,
  ) => boolean | undefined,
) {
  if (!isAstRecord(value)) return;
  if (visitor(value, parent) === false) return;

  for (const key in value) {
    if (key === 'type' || SKIP_KEYS.has(key)) continue;
    const child = value[key];
    if (Array.isArray(child)) {
      for (const item of child) visit(item, value, visitor);
    } else {
      visit(child, value, visitor);
    }
  }
}

function isFunctionNode(node: AstRecord): boolean {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression'
  );
}

function getFunctionName(
  node: AstRecord,
  parent: AstRecord | undefined,
): string {
  if (isRecord(node.id) && typeof node.id.name === 'string')
    return node.id.name;
  if (
    parent?.type === 'VariableDeclarator' &&
    isRecord(parent.id) &&
    typeof parent.id.name === 'string'
  ) {
    return parent.id.name;
  }
  if (parent && 'key' in parent && isRecord(parent.key))
    return getKeyName(parent.key);
  return '<anonymous>';
}

function shouldSkipFunctionName(name: string): boolean {
  return name === '<anonymous>';
}

function hasIgnoreComment(
  node: AstRecord,
  parent: AstRecord | undefined,
  lineIndex: number[],
  comments: SourceComment[],
): boolean {
  const range = getNodeRange(node, parent);
  if (!range) return false;

  return comments.some(
    (comment) =>
      comment.value.includes(IGNORE_COMMENT) &&
      (isInsideRange(comment, range) ||
        isLeadingComment(comment, range, lineIndex)),
  );
}

function getNodeRange(
  node: AstRecord,
  parent: AstRecord | undefined,
): [number, number] | undefined {
  const owner = isExportNode(parent) ? parent : node;
  return Array.isArray(owner.range) &&
    typeof owner.range[0] === 'number' &&
    typeof owner.range[1] === 'number'
    ? [owner.range[0], owner.range[1]]
    : undefined;
}

function isExportNode(node: AstRecord | undefined): node is AstRecord {
  return (
    node?.type === 'ExportNamedDeclaration' ||
    node?.type === 'ExportDefaultDeclaration'
  );
}

function isInsideRange(
  comment: SourceComment,
  range: [number, number],
): boolean {
  return comment.start >= range[0] && comment.end <= range[1];
}

function isLeadingComment(
  comment: SourceComment,
  range: [number, number],
  lineIndex: number[],
): boolean {
  if (comment.end > range[0]) return false;
  return (
    getLineFromIndex(lineIndex, comment.end) + 1 >=
    getLineFromIndex(lineIndex, range[0])
  );
}

function getKeyName(key: Record<string, unknown>): string {
  if (typeof key.name === 'string') return key.name;
  if (typeof key.value === 'string' || typeof key.value === 'number')
    return String(key.value);
  return '<computed>';
}

function getRangeStart(node: AstRecord): number | undefined {
  return Array.isArray(node.range) && typeof node.range[0] === 'number'
    ? node.range[0]
    : undefined;
}

function getLine(
  node: AstRecord,
  lineIndex: number[],
  range: number | undefined,
): number {
  const loc = node.loc;
  if (
    isRecord(loc) &&
    isRecord(loc.start) &&
    typeof loc.start.line === 'number'
  ) {
    return loc.start.line;
  }
  if (range === undefined) return 1;
  return getLineFromIndex(lineIndex, range);
}

function buildLineIndex(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1);
  }
  return offsets;
}

function getLineFromIndex(lineIndex: number[], offset: number): number {
  let lo = 0;
  let hi = lineIndex.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lineIndex[mid] <= offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Counts "significant" tokens — AST node types and tagged values — excluding
 * closing markers (e.g. `/BlockStatement`) and non-alphabetic tokens like `[`.
 * This serves as a rough proxy for AST complexity.
 */
function countNodeTokens(tokens: string[]): number {
  return tokens.filter(
    (token) => !token.startsWith('/') && /^[A-Za-z]/u.test(token),
  ).length;
}
