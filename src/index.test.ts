import { describe, expect, test } from 'vitest';
import { findDuplicateFunctionsInSources } from './index';

describe('findDuplicateFunctionsInSources', () => {
  test('groups functions with renamed parameters and locals', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.ts',
          source: `
            export function getText(value: unknown) {
              const text = String(value).trim();
              return text.length > 0 ? text : undefined;
            }
          `,
        },
        {
          file: 'two.ts',
          source: `
            export function readLabel(input: unknown) {
              const label = String(input).trim();
              return label.length > 0 ? label : undefined;
            }
          `,
        },
        {
          file: 'three.ts',
          source: `
            export function add(left: number, right: number) {
              return left + right;
            }
          `,
        },
      ],
      { minNodes: 4, minScore: 0.6, minTokens: 12 },
    );

    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].functions.map((item) => item.name)).toEqual([
      'getText',
      'readLabel',
    ]);
  });

  test('reports source ranges for duplicate functions', () => {
    const firstSource = [
      'export function first(value: unknown) {',
      '  const text = String(value).trim();',
      '  return text.length > 0 ? text : undefined;',
      '}',
    ].join('\n');
    const secondSource = [
      'export function second(input: unknown) {',
      '  const label = String(input).trim();',
      '  return label.length > 0 ? label : undefined;',
      '}',
    ].join('\n');

    const report = findDuplicateFunctionsInSources(
      [
        { file: 'one.ts', source: firstSource },
        { file: 'two.ts', source: secondSource },
      ],
      { minNodes: 4, minScore: 0.6, minTokens: 12 },
    );

    const first = report.groups[0]?.functions.find(
      (item) => item.name === 'first',
    );
    expect(first).toBeDefined();
    expect(firstSource.slice(first?.start, first?.end)).toBe(firstSource);
  });

  test('skips tests by default', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.test.ts',
          source: 'function one(value: string) { return value.trim(); }',
        },
        {
          file: 'two.test.ts',
          source: 'function two(input: string) { return input.trim(); }',
        },
      ],
      { minNodes: 1, minScore: 0.6, minTokens: 1 },
    );

    expect(report.functions).toBe(0);
    expect(report.groups).toHaveLength(0);
  });

  test('ignores anonymous functions', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.ts',
          source: `
            [1].map((value) => {
              const text = String(value).trim();
              return text.length > 0 ? text : undefined;
            });
          `,
        },
        {
          file: 'two.ts',
          source: `
            [2].map((input) => {
              const label = String(input).trim();
              return label.length > 0 ? label : undefined;
            });
          `,
        },
      ],
      { minNodes: 4, minScore: 0.6, minTokens: 12 },
    );

    expect(report.functions).toBe(0);
    expect(report.groups).toHaveLength(0);
  });

  test('groups uppercase route-handler function names', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.ts',
          source: `
            export function GET(value) {
              const text = String(value).trim();
              return text.length > 0 ? text : undefined;
            }
          `,
        },
        {
          file: 'two.ts',
          source: `
            export const POST = (input) => {
              const label = String(input).trim();
              return label.length > 0 ? label : undefined;
            };
          `,
        },
      ],
      { minNodes: 4, minScore: 0.6, minTokens: 12 },
    );

    expect(report.functions).toBe(2);
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]?.functions.map((item) => item.name)).toEqual([
      'GET',
      'POST',
    ]);
  });

  test('ignores trivial template value builders', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.ts',
          source: `
            function buildClientKey(userId: string, tokenFingerprint: string) {
              return \`\${userId}:\${tokenFingerprint}\`;
            }
          `,
        },
        {
          file: 'two.ts',
          source: `
            export function createAssistantPartKey(type: string, index: number) {
              return \`\${type}:\${index}\`;
            }
          `,
        },
      ],
      { minNodes: 1, minScore: 0.6, minTokens: 1 },
    );

    expect(report.functions).toBe(0);
    expect(report.groups).toHaveLength(0);
  });

  test('ignores trivial string concat value builders', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.ts',
          source: `
            function buildClientKey(userId: string, tokenFingerprint: string) {
              return userId + ':' + tokenFingerprint;
            }
          `,
        },
        {
          file: 'two.ts',
          source: `
            export function createAssistantPartKey(type: string, index: number) {
              return type + ':' + index;
            }
          `,
        },
      ],
      { minNodes: 1, minScore: 0.6, minTokens: 1 },
    );

    expect(report.functions).toBe(0);
    expect(report.groups).toHaveLength(0);
  });

  test('ignores trivial call adapters', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.ts',
          source: `
            export const onOpenChange = (open: boolean) => setOpen(open);

            export const mutationFn = ({ id, name }: { id: string; name: string }) =>
              renameProject(id, name);
          `,
        },
        {
          file: 'two.ts',
          source: `
            export const onVisibilityChange = (visible: boolean) => {
              setVisible(visible);
            };

            export const updateFn = ({ projectId, title }: { projectId: string; title: string }) =>
              updateProject(projectId, title);
          `,
        },
      ],
      { minNodes: 1, minScore: 0.6, minTokens: 1 },
    );

    expect(report.functions).toBe(0);
    expect(report.groups).toHaveLength(0);
  });

  test('keeps guard helpers eligible', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.ts',
          source: `
            function isRecord(value: unknown) {
              return typeof value === 'object' && value !== null && !Array.isArray(value);
            }
          `,
        },
        {
          file: 'two.ts',
          source: `
            function isObjectRecord(input: unknown) {
              return typeof input === 'object' && input !== null && !Array.isArray(input);
            }
          `,
        },
      ],
      { minNodes: 1, minScore: 0.6, minTokens: 1 },
    );

    expect(report.functions).toBe(2);
    expect(report.groups).toHaveLength(1);
  });

  test('keeps call-based helpers eligible', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.ts',
          source: `
            function escapeLikePattern(value: string) {
              return value.replace(/[%_]/g, '\\$&');
            }
          `,
        },
        {
          file: 'two.ts',
          source: `
            function escapeSearchPattern(input: string) {
              return input.replace(/[%_]/g, '\\$&');
            }
          `,
        },
      ],
      { minNodes: 1, minScore: 0.3, minTokens: 1 },
    );

    expect(report.functions).toBe(2);
    expect(report.groups).toHaveLength(1);
  });

  test('does not conflate helpers with different regex literals', () => {
    const report = findDuplicateFunctionsInSources([
      {
        file: 'one.ts',
        source: `
          export function extractEmail(value: string) {
            const match = value.match(/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/i);
            if (!match) return undefined;

            return match[0].toLowerCase();
          }
        `,
      },
      {
        file: 'two.ts',
        source: `
          export function extractHexColor(input: string) {
            const result = input.match(/#[0-9a-f]{6}\\b/i);
            if (!result) return undefined;

            return result[0].toLowerCase();
          }
        `,
      },
    ]);

    expect(report.functions).toBe(2);
    expect(report.groups).toHaveLength(0);
  });

  test('does not conflate helpers with different template literal text', () => {
    const report = findDuplicateFunctionsInSources([
      {
        file: 'one.ts',
        source: [
          'export function buildUserLookupQuery(db, userId: string) {',
          '  const query = `',
          '    select id, email, display_name',
          '    from users',
          '    where id = ${userId} and deleted_at is null',
          '  `.trim();',
          '',
          '  return db.prepare(query).get(userId);',
          '}',
        ].join('\n'),
      },
      {
        file: 'two.ts',
        source: [
          'export function buildSessionCleanupQuery(client, sessionId: string) {',
          '  const statement = `',
          '    delete from sessions',
          '    where id = ${sessionId} and expires_at < now()',
          '    returning id, user_id',
          '  `.trim();',
          '',
          '  return client.prepare(statement).get(sessionId);',
          '}',
        ].join('\n'),
      },
    ]);

    expect(report.functions).toBe(2);
    expect(report.groups).toHaveLength(0);
  });

  test('ignores trivial JSX wrapper components', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.tsx',
          source: `
            function MessageListItem({ children, style, ref }) {
              return (
                <div ref={ref} style={style} className="w-full min-w-0">
                  {children}
                </div>
              );
            }
          `,
        },
        {
          file: 'two.tsx',
          source: `
            function MessageListContent({ children, style, ref }) {
              return (
                <div ref={ref} style={style} className="w-full mx-auto min-w-0">
                  {children}
                </div>
              );
            }
          `,
        },
      ],
      { minNodes: 1, minScore: 0.6, minTokens: 1 },
    );

    expect(report.functions).toBe(0);
    expect(report.groups).toHaveLength(0);
  });

  test('keeps conditional JSX components eligible', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.tsx',
          source: `
            function UserSummary({ user }) {
              return <div>{user.visible ? user.name : 'Hidden'}</div>;
            }
          `,
        },
        {
          file: 'two.tsx',
          source: `
            function ProfileSummary({ profile }) {
              return <div>{profile.visible ? profile.name : 'Hidden'}</div>;
            }
          `,
        },
      ],
      { minNodes: 1, minScore: 0.6, minTokens: 1 },
    );

    expect(report.functions).toBe(2);
    expect(report.groups).toHaveLength(1);
  });

  test('ignores functions with ts-twin-ignore comments', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.ts',
          source: `
            // ts-twin-ignore: intentionally split
            export function getText(value) {
              const text = String(value).trim();
              return text.length > 0 ? text : undefined;
            }
          `,
        },
        {
          file: 'two.ts',
          source: `
            export const readLabel = (input) => {
              const label = String(input).trim();
              return label.length > 0 ? label : undefined;
            };
          `,
        },
      ],
      { minNodes: 4, minScore: 0.6, minTokens: 12 },
    );

    expect(report.functions).toBe(1);
    expect(report.groups).toHaveLength(0);
  });

  test('does not let ts-twin-ignore comments bleed to later functions', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.ts',
          source: `
            // ts-twin-ignore: intentionally split
            export function ignored(value) {
              const text = String(value).trim();
              return text.length > 0 ? text : undefined;
            }

            export function getText(value) {
              const text = String(value).trim();
              return text.length > 0 ? text : undefined;
            }
          `,
        },
        {
          file: 'two.ts',
          source: `
            export function readLabel(input) {
              const label = String(input).trim();
              return label.length > 0 ? label : undefined;
            }
          `,
        },
      ],
      { minNodes: 4, minScore: 0.6, minTokens: 12 },
    );

    expect(report.functions).toBe(2);
    expect(report.groups).toHaveLength(1);
  });

  test('does not compare TypeScript and JavaScript files', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.ts',
          source: `
            export function getText(value) {
              const text = String(value).trim();
              return text.length > 0 ? text : undefined;
            }
          `,
        },
        {
          file: 'two.js',
          source: `
            export function readLabel(input) {
              const label = String(input).trim();
              return label.length > 0 ? label : undefined;
            }
          `,
        },
      ],
      { minNodes: 4, minScore: 0.6, minTokens: 12 },
    );

    expect(report.functions).toBe(2);
    expect(report.groups).toHaveLength(0);
  });

  test('compares files within the same language family', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.mts',
          source: `
            export function getText(value) {
              const text = String(value).trim();
              return text.length > 0 ? text : undefined;
            }
          `,
        },
        {
          file: 'two.tsx',
          source: `
            export function readLabel(input) {
              const label = String(input).trim();
              return label.length > 0 ? label : undefined;
            }
          `,
        },
        {
          file: 'three.mjs',
          source: `
            export function getTitle(value) {
              const text = String(value).trim();
              return text.length > 0 ? text : undefined;
            }
          `,
        },
        {
          file: 'four.jsx',
          source: `
            export function readTitle(input) {
              const label = String(input).trim();
              return label.length > 0 ? label : undefined;
            }
          `,
        },
      ],
      { minNodes: 4, minScore: 0.6, minTokens: 12 },
    );

    expect(report.groups).toHaveLength(2);
    expect(report.groups.map((group) => group.functions.length)).toEqual([
      2, 2,
    ]);
  });

  test('suppresses small near-matches at the default score', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.ts',
          source: `
            export function readName(value) {
              if (!value) return undefined;
              return String(value.name).trim();
            }
          `,
        },
        {
          file: 'two.ts',
          source: `
            export function readTitle(input) {
              if (!input) return null;
              return String(input.title).trim();
            }
          `,
        },
      ],
      { minNodes: 1, minTokens: 1 },
    );

    expect(report.functions).toBe(2);
    expect(report.groups).toHaveLength(0);
  });

  test('reports larger near-matches at the default score', () => {
    const report = findDuplicateFunctionsInSources(
      [
        {
          file: 'one.ts',
          source: `
            export function describeUser(value) {
              const parts = [];
              if (value.name) parts.push(String(value.name).trim());
              if (value.email) parts.push(String(value.email).toLowerCase());
              if (value.phone) parts.push(String(value.phone).trim());
              if (value.city) parts.push(String(value.city).trim());
              if (value.country) parts.push(String(value.country).trim());
              if (value.company) parts.push(String(value.company).trim());
              if (value.role) parts.push(String(value.role).trim());
              if (value.team) parts.push(String(value.team).trim());
              return parts.join(', ');
            }
          `,
        },
        {
          file: 'two.ts',
          source: `
            export function summarizeProfile(input) {
              const values = [];
              if (input.name) values.push(String(input.name).trim());
              if (input.email) values.push(String(input.email).toLowerCase());
              if (input.phone) values.push(String(input.phone).trim());
              if (input.city) values.push(String(input.city).trim());
              if (input.country) values.push(String(input.country).trim());
              if (input.company) values.push(String(input.company).trim());
              if (input.role) values.push(String(input.role).trim());
              if (input.team) values.push(String(input.team).trim());
              return values.join(' | ');
            }
          `,
        },
      ],
      { minNodes: 1, minTokens: 1 },
    );

    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].score).toBeGreaterThanOrEqual(0.82);
  });
});
