import { describe, expect, test } from 'vitest';
import {
  formatPreviewSnippet,
  inferPreviewLanguage,
  limitPreviewSource,
} from './preview';

describe('preview helpers', () => {
  test('infers Shiki languages from JS and TS extensions', () => {
    expect(inferPreviewLanguage('src/file.ts')).toBe('typescript');
    expect(inferPreviewLanguage('src/file.tsx')).toBe('tsx');
    expect(inferPreviewLanguage('src/file.js')).toBe('javascript');
    expect(inferPreviewLanguage('src/file.jsx')).toBe('jsx');
  });

  test('limits preview source by line count', () => {
    const result = limitPreviewSource(['one', 'two', 'three'].join('\n'), 2);

    expect(result).toEqual({
      source: ['one', 'two'].join('\n'),
      truncatedLines: 1,
    });
  });

  test('formats plain preview snippets when color is disabled', async () => {
    const result = await formatPreviewSnippet(
      'src/file.ts',
      ['const value = 1;', 'return value;'].join('\n'),
      { color: false, maxLines: 1, theme: 'vitesse-dark' },
    );

    expect(result).toBe(
      ['    const value = 1;', '    ... 1 more line(s) truncated'].join('\n'),
    );
  });
});
