import path from 'node:path';
import { codeToANSI } from '@shikijs/cli';

type PreviewLanguage = 'javascript' | 'jsx' | 'tsx' | 'typescript';

export type PreviewFormatOptions = {
  color: boolean;
  maxLines: number;
  theme: string;
};

export function inferPreviewLanguage(file: string): PreviewLanguage {
  const extension = path.extname(file);
  if (extension === '.tsx') return 'tsx';
  if (extension === '.jsx') return 'jsx';
  if (extension.includes('ts')) return 'typescript';
  return 'javascript';
}

export function limitPreviewSource(
  source: string,
  maxLines: number,
): { source: string; truncatedLines: number } {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length <= maxLines) {
    return { source: lines.join('\n'), truncatedLines: 0 };
  }

  return {
    source: lines.slice(0, maxLines).join('\n'),
    truncatedLines: lines.length - maxLines,
  };
}

export async function formatPreviewSnippet(
  file: string,
  source: string,
  options: PreviewFormatOptions,
): Promise<string> {
  const limited = limitPreviewSource(source, options.maxLines);
  const language = inferPreviewLanguage(file);
  let rendered = limited.source;

  if (options.color) {
    try {
      rendered = await codeToANSI(
        limited.source,
        language,
        options.theme as never,
      );
    } catch {
      rendered = limited.source;
    }
  }

  const lines = indentLines(rendered.trimEnd(), '    ');
  return limited.truncatedLines > 0
    ? `${lines}\n    ... ${limited.truncatedLines} more line(s) truncated`
    : lines;
}

function indentLines(value: string, prefix: string): string {
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}
