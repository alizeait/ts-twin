import { isRecord, readArray } from './shared';
import type { AstRecord } from './types';

export function collectParamNames(node: AstRecord): string[] {
  const names: string[] = [];
  for (const param of readArray(node.params)) collectPatternNames(param, names);
  return names;
}

export function collectPatternNames(pattern: unknown, names: string[]) {
  if (!isRecord(pattern)) return;
  if (pattern.type === 'Identifier' && typeof pattern.name === 'string') {
    names.push(pattern.name);
    return;
  }

  if (pattern.type === 'RestElement')
    collectPatternNames(pattern.argument, names);
  if (pattern.type === 'AssignmentPattern')
    collectPatternNames(pattern.left, names);
  if (pattern.type === 'TSParameterProperty')
    collectPatternNames(pattern.parameter, names);
  for (const key of ['elements', 'properties'] as const) {
    for (const item of readArray(pattern[key]))
      collectPatternNames(item, names);
  }
  if (pattern.type === 'Property') collectPatternNames(pattern.value, names);
}
