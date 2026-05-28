/**
 * Adversarial probe suite for ts-twin.
 *
 * Each `probe(...)` invocation runs `findDuplicateFunctionsInSources` against a
 * pair of fixtures at LIBRARY DEFAULTS (no overridden thresholds) and records
 * the outcome into a shared table. The `afterAll` hook prints a markdown table
 * to stdout so a single `pnpm test` run produces the report directly.
 *
 * Assertions are intentionally permissive: each test only checks that the
 * outcome was captured. The interesting signal is the printed table, which
 * shows which structural patterns trip the algorithm and how close to the
 * decision boundary each case sits.
 */
import { afterAll, describe, expect, test } from 'vitest';
import { findDuplicateFunctionsInSources } from './index';
import type { SourceFile } from './types';

type ExpectedOutcome = 'group' | 'no-group';

type Outcome = {
  id: string;
  label: string;
  expected: ExpectedOutcome;
  grouped: boolean;
  score: number | null;
  rawScore: number | null;
  members: number;
  functions: number;
  tokens: number[];
  nodes: number[];
};

const outcomes: Outcome[] = [];

function probe(
  id: string,
  label: string,
  expected: ExpectedOutcome,
  sources: SourceFile[],
): Outcome {
  const report = findDuplicateFunctionsInSources(sources);
  const grouped = report.groups.length > 0;
  const group = grouped ? report.groups[0] : undefined;

  // Second pass at minScore=0 to surface the raw computed score even when
  // the pair fell below the 0.82 default. This is purely diagnostic so we can
  // observe the sensitivity gradient near and below the decision boundary.
  const relaxed = findDuplicateFunctionsInSources(sources, { minScore: 0 });
  const rawScore = relaxed.groups.length > 0 ? relaxed.groups[0].score : null;

  const tokenSource =
    group?.functions ??
    relaxed.groups[0]?.functions ??
    [];

  const outcome: Outcome = {
    id,
    label,
    expected,
    grouped,
    score: group ? Number(group.score.toFixed(3)) : null,
    rawScore: rawScore === null ? null : Number(rawScore.toFixed(3)),
    members: group ? group.functions.length : 0,
    functions: report.functions,
    tokens: tokenSource.map((fn) => fn.tokens),
    nodes: tokenSource.map((fn) => fn.nodes),
  };
  outcomes.push(outcome);
  return outcome;
}

describe('false positive probe', () => {
  test('N1 magic-number scale', () => {
    const outcome = probe('N1', 'magic-number scale (x*1000 vs x*60)', 'no-group', [
      {
        file: 'a/millis.ts',
        source: `
          export function multiplyByMillis(value: number) {
            if (typeof value !== 'number') return 0;
            if (!Number.isFinite(value)) return 0;
            if (value < 0) return 0;
            const scaled = Math.round(value * 1000);
            return scaled;
          }
        `,
      },
      {
        file: 'b/seconds.ts',
        source: `
          export function multiplyBySeconds(value: number) {
            if (typeof value !== 'number') return 0;
            if (!Number.isFinite(value)) return 0;
            if (value < 0) return 0;
            const scaled = Math.round(value * 60);
            return scaled;
          }
        `,
      },
    ]);
    expect(outcome).toBeDefined();
  });

  test('N2 length-bound validators', () => {
    const outcome = probe(
      'N2',
      'length-bound validators (max 32 vs max 12)',
      'no-group',
      [
        {
          file: 'a/username.ts',
          source: `
            export function isShortUsername(value: string) {
              if (typeof value !== 'string') return false;
              if (value.length === 0) return false;
              if (value.length > 32) return false;
              const head = value.charAt(0);
              if (head === ' ') return false;
              return true;
            }
          `,
        },
        {
          file: 'b/postal.ts',
          source: `
            export function isShortPostalCode(value: string) {
              if (typeof value !== 'string') return false;
              if (value.length === 0) return false;
              if (value.length > 12) return false;
              const head = value.charAt(0);
              if (head === ' ') return false;
              return true;
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('G1 generic vs non-generic identical body', () => {
    const outcome = probe(
      'G1',
      'generic vs non-generic (types erased by SKIP_KEYS)',
      'group',
      [
        {
          file: 'a/uniqueGeneric.ts',
          source: `
            export function uniqueGeneric<T>(items: readonly T[]): T[] {
              const seen = new Set<T>();
              const result: T[] = [];
              for (const item of items) {
                if (seen.has(item)) continue;
                seen.add(item);
                result.push(item);
              }
              return result;
            }
          `,
        },
        {
          file: 'b/uniqueAny.ts',
          source: `
            export function uniqueAny(items: readonly any[]) {
              const seen = new Set<any>();
              const result: any[] = [];
              for (const item of items) {
                if (seen.has(item)) continue;
                seen.add(item);
                result.push(item);
              }
              return result;
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('R1 reducer twins (different domain, same switch shape)', () => {
    const outcome = probe(
      'R1',
      'redux reducer twins (user vs cart)',
      'no-group',
      [
        {
          file: 'a/userReducer.ts',
          source: `
            export function userReducer(state, action) {
              switch (action.type) {
                case 'USER_LOGIN':
                  return { ...state, currentUser: action.payload, isAuthenticated: true };
                case 'USER_LOGOUT':
                  return { ...state, currentUser: null, isAuthenticated: false };
                case 'USER_UPDATE':
                  return { ...state, currentUser: { ...state.currentUser, ...action.payload } };
                default:
                  return state;
              }
            }
          `,
        },
        {
          file: 'b/cartReducer.ts',
          source: `
            export function cartReducer(state, action) {
              switch (action.type) {
                case 'CART_ADD':
                  return { ...state, items: action.payload, hasItems: true };
                case 'CART_CLEAR':
                  return { ...state, items: null, hasItems: false };
                case 'CART_UPDATE':
                  return { ...state, items: { ...state.items, ...action.payload } };
                default:
                  return state;
              }
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('R2 action creator twins', () => {
    const outcome = probe(
      'R2',
      'action creators (USER_UPDATED vs CART_UPDATED)',
      'no-group',
      [
        {
          file: 'a/createUserAction.ts',
          source: `
            export function createUserAction(payload, options) {
              const action = {
                type: 'USER_UPDATED',
                payload,
                meta: { source: 'user', timestamp: Date.now(), correlationId: options.correlationId },
              };
              if (!payload) {
                action.meta.source = 'system';
              }
              if (options.silent) {
                action.meta.source = 'background';
              }
              return action;
            }
          `,
        },
        {
          file: 'b/createCartAction.ts',
          source: `
            export function createCartAction(payload, options) {
              const action = {
                type: 'CART_UPDATED',
                payload,
                meta: { source: 'cart', timestamp: Date.now(), correlationId: options.correlationId },
              };
              if (!payload) {
                action.meta.source = 'system';
              }
              if (options.silent) {
                action.meta.source = 'background';
              }
              return action;
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('S1 unrelated-domain dispatch (auth vs theme)', () => {
    const outcome = probe(
      'S1',
      'switch dispatch with unrelated domains (auth vs theme)',
      'no-group',
      [
        {
          file: 'a/handleAuthEvent.ts',
          source: `
            export function handleAuthEvent(event) {
              switch (event.kind) {
                case 'LOGIN':
                  return { logged: true, user: event.payload, sessionId: event.id };
                case 'LOGOUT':
                  return { logged: false, user: null, sessionId: null };
                case 'REFRESH':
                  return { logged: true, user: event.payload, sessionId: event.id };
                default:
                  return { logged: false, user: null, sessionId: null };
              }
            }
          `,
        },
        {
          file: 'b/handleThemeEvent.ts',
          source: `
            export function handleThemeEvent(event) {
              switch (event.kind) {
                case 'LIGHT':
                  return { dark: false, palette: event.payload, themeId: event.id };
                case 'DARK':
                  return { dark: true, palette: null, themeId: null };
                case 'SYSTEM':
                  return { dark: false, palette: event.payload, themeId: event.id };
                default:
                  return { dark: false, palette: null, themeId: null };
              }
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('C1 fetch + map handlers', () => {
    const outcome = probe(
      'C1',
      'fetch + map handlers (users vs products)',
      'group',
      [
        {
          file: 'a/fetchUsers.ts',
          source: `
            export async function fetchUsers() {
              const response = await fetch('/api/users');
              if (!response.ok) {
                throw new Error('Failed to fetch users');
              }
              const data = await response.json();
              return data.map((item) => ({ id: item.id, name: item.name, slug: item.slug }));
            }
          `,
        },
        {
          file: 'b/fetchProducts.ts',
          source: `
            export async function fetchProducts() {
              const response = await fetch('/api/products');
              if (!response.ok) {
                throw new Error('Failed to fetch products');
              }
              const data = await response.json();
              return data.map((item) => ({ id: item.id, name: item.name, slug: item.slug }));
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('C2 express CRUD handlers', () => {
    const outcome = probe(
      'C2',
      'express handlers (getUserById vs getOrderById)',
      'no-group',
      [
        {
          file: 'a/getUserById.ts',
          source: `
            export async function getUserById(req, res) {
              const id = req.params.id;
              const user = await db.user.findUnique({ where: { id } });
              if (!user) {
                res.status(404).json({ error: 'Not found' });
                return;
              }
              console.log('fetched user', id);
              res.json(user);
            }
          `,
        },
        {
          file: 'b/getOrderById.ts',
          source: `
            export async function getOrderById(req, res) {
              const id = req.params.id;
              const order = await db.order.findUnique({ where: { id } });
              if (!order) {
                res.status(404).json({ error: 'Not found' });
                return;
              }
              console.log('fetched order', id);
              res.json(order);
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('F1 field summariser (different field names)', () => {
    const outcome = probe(
      'F1',
      'field summariser (user fields vs company fields)',
      'no-group',
      [
        {
          file: 'a/summarizeUser.ts',
          source: `
            export function summarizeUser(user) {
              const parts = [];
              if (user.name) parts.push(String(user.name).trim());
              if (user.email) parts.push(String(user.email).toLowerCase());
              if (user.phone) parts.push(String(user.phone).trim());
              if (user.city) parts.push(String(user.city).trim());
              if (user.country) parts.push(String(user.country).trim());
              if (user.zip) parts.push(String(user.zip).trim());
              return parts.join(', ');
            }
          `,
        },
        {
          file: 'b/summarizeCompany.ts',
          source: `
            export function summarizeCompany(company) {
              const parts = [];
              if (company.legalName) parts.push(String(company.legalName).trim());
              if (company.taxId) parts.push(String(company.taxId).toLowerCase());
              if (company.industry) parts.push(String(company.industry).trim());
              if (company.region) parts.push(String(company.region).trim());
              if (company.continent) parts.push(String(company.continent).trim());
              if (company.headcount) parts.push(String(company.headcount).trim());
              return parts.join(', ');
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('O1 operator flip (> 0 vs < 0)', () => {
    const outcome = probe(
      'O1',
      'operator flip (totalIncome vs totalExpenses)',
      'no-group',
      [
        {
          file: 'a/totalIncome.ts',
          source: `
            export function totalIncome(records) {
              let total = 0;
              for (const record of records) {
                if (record.amount > 0) {
                  total += record.amount;
                }
              }
              console.log('total income', total);
              return total;
            }
          `,
        },
        {
          file: 'b/totalExpenses.ts',
          source: `
            export function totalExpenses(records) {
              let total = 0;
              for (const record of records) {
                if (record.amount < 0) {
                  total += record.amount;
                }
              }
              console.log('total expenses', total);
              return total;
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('O2 sort asc/desc (operand order flip)', () => {
    const outcome = probe(
      'O2',
      'sort asc vs desc (operand flip)',
      'no-group',
      [
        {
          file: 'a/sortAscByCreated.ts',
          source: `
            export function sortAscByCreated(records) {
              const copy = [...records];
              copy.sort((left, right) => {
                const leftDate = Date.parse(left.createdAt);
                const rightDate = Date.parse(right.createdAt);
                return leftDate - rightDate;
              });
              return copy;
            }
          `,
        },
        {
          file: 'b/sortDescByCreated.ts',
          source: `
            export function sortDescByCreated(records) {
              const copy = [...records];
              copy.sort((left, right) => {
                const leftDate = Date.parse(left.createdAt);
                const rightDate = Date.parse(right.createdAt);
                return rightDate - leftDate;
              });
              return copy;
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('B1 try/catch boilerplate twins', () => {
    const outcome = probe(
      'B1',
      'try/catch boilerplate (user API vs order API)',
      'group',
      [
        {
          file: 'a/callUserApi.ts',
          source: `
            export async function callUserApi(url) {
              try {
                const response = await fetch(url);
                if (!response.ok) {
                  throw new Error('User API failed');
                }
                const body = await response.json();
                return body;
              } catch (error) {
                console.error('User API error', error);
                throw error;
              }
            }
          `,
        },
        {
          file: 'b/callOrderApi.ts',
          source: `
            export async function callOrderApi(url) {
              try {
                const response = await fetch(url);
                if (!response.ok) {
                  throw new Error('Order API failed');
                }
                const body = await response.json();
                return body;
              } catch (error) {
                console.error('Order API error', error);
                throw error;
              }
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('J1 Array.from builders with different domain literals', () => {
    const outcome = probe(
      'J1',
      'Array.from builders (users vs groups)',
      'no-group',
      [
        {
          file: 'a/buildUserList.ts',
          source: `
            export function buildUserList(count) {
              const result = Array.from({ length: count }, (_, index) => ({
                id: index,
                name: 'user' + index,
                role: 'member',
                active: true,
              }));
              return result;
            }
          `,
        },
        {
          file: 'b/buildGroupList.ts',
          source: `
            export function buildGroupList(count) {
              const result = Array.from({ length: count }, (_, index) => ({
                id: index,
                name: 'group' + index,
                role: 'collection',
                active: true,
              }));
              return result;
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('K1 parser diagnostics (different property names)', () => {
    const outcome = probe(
      'K1',
      'diagnostic builders (type/message vs kind/text)',
      'no-group',
      [
        {
          file: 'a/buildErrorDiagnostic.ts',
          source: `
            export function buildErrorDiagnostic(node) {
              if (!node) return null;
              if (!node.location) return null;
              const diagnostic = {
                type: 'error',
                message: node.text,
                line: node.location.line,
                column: node.location.column,
                source: node.location.file,
              };
              return diagnostic;
            }
          `,
        },
        {
          file: 'b/buildWarningDiagnostic.ts',
          source: `
            export function buildWarningDiagnostic(node) {
              if (!node) return null;
              if (!node.location) return null;
              const diagnostic = {
                kind: 'warning',
                text: node.text,
                line: node.location.line,
                column: node.location.column,
                source: node.location.file,
              };
              return diagnostic;
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('N3 different physics formulas (celsius vs pounds)', () => {
    const outcome = probe(
      'N3',
      'physics formulas (celsiusToFahrenheit vs poundsToKilograms)',
      'no-group',
      [
        {
          file: 'a/celsiusToFahrenheit.ts',
          source: `
            export function celsiusToFahrenheit(value: number) {
              if (typeof value !== 'number') return 0;
              if (!Number.isFinite(value)) return 0;
              const scaled = value * 1.8;
              const shifted = scaled + 32;
              const rounded = Math.round(shifted * 100) / 100;
              return rounded;
            }
          `,
        },
        {
          file: 'b/poundsToKilograms.ts',
          source: `
            export function poundsToKilograms(value: number) {
              if (typeof value !== 'number') return 0;
              if (!Number.isFinite(value)) return 0;
              const scaled = value * 0.453592;
              const shifted = scaled + 0;
              const rounded = Math.round(shifted * 10000) / 10000;
              return rounded;
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('L1 callback-param rename (inner arrow params not normalized)', () => {
    const outcome = probe(
      'L1',
      "callback-param rename (item vs entry inside .filter/.map)",
      'group',
      [
        {
          file: 'a/listValidUsersItem.ts',
          source: `
            export function listValidUsers(users) {
              if (!Array.isArray(users)) return [];
              const valid = users.filter((item) => item != null && item.active);
              const names = valid.map((item) => String(item.name).trim());
              const sorted = names.sort();
              console.log('found', sorted.length);
              return sorted;
            }
          `,
        },
        {
          file: 'b/listValidUsersEntry.ts',
          source: `
            export function listValidUsers(users) {
              if (!Array.isArray(users)) return [];
              const valid = users.filter((entry) => entry != null && entry.active);
              const names = valid.map((entry) => String(entry.name).trim());
              const sorted = names.sort();
              console.log('found', sorted.length);
              return sorted;
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('L2 for-of variable rename (locals normalized)', () => {
    const outcome = probe(
      'L2',
      'for-of variable rename (value vs num)',
      'group',
      [
        {
          file: 'a/sumValues.ts',
          source: `
            export function sumValues(items) {
              if (!Array.isArray(items)) return 0;
              let total = 0;
              for (const value of items) {
                if (typeof value !== 'number') continue;
                total += value;
              }
              console.log('total', total);
              return total;
            }
          `,
        },
        {
          file: 'b/sumNums.ts',
          source: `
            export function sumNums(items) {
              if (!Array.isArray(items)) return 0;
              let total = 0;
              for (const num of items) {
                if (typeof num !== 'number') continue;
                total += num;
              }
              console.log('total', total);
              return total;
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('L3 property-name sensitivity (2 of 8 properties differ)', () => {
    const outcome = probe(
      'L3',
      'property-name sensitivity (2 of 8 properties differ)',
      'no-group',
      [
        {
          file: 'a/buildEightFieldRecord.ts',
          source: `
            export function buildEightFieldRecord(source) {
              if (!source) return null;
              const result = {
                alpha: source.alpha,
                bravo: source.bravo,
                charlie: source.charlie,
                delta: source.delta,
                echo: source.echo,
                foxtrot: source.foxtrot,
                golf: source.golf,
                hotel: source.hotel,
              };
              console.log('built', Object.keys(result).length);
              return result;
            }
          `,
        },
        {
          file: 'b/buildEightFieldRecord.ts',
          source: `
            export function buildEightFieldRecord(source) {
              if (!source) return null;
              const result = {
                alpha: source.alpha,
                bravo: source.bravo,
                charlie: source.charlie,
                delta: source.delta,
                echo: source.echo,
                foxtrot: source.foxtrot,
                indiaDifferent: source.indiaDifferent,
                julietDifferent: source.julietDifferent,
              };
              console.log('built', Object.keys(result).length);
              return result;
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  test('P1 class validator methods (different domain)', () => {
    const outcome = probe(
      'P1',
      'class validators (EmailValidator vs PhoneValidator)',
      'no-group',
      [
        {
          file: 'a/EmailValidator.ts',
          source: `
            export class EmailValidator {
              validate(value) {
                const normalized = String(value).trim().toLowerCase();
                if (normalized.length === 0) {
                  return { ok: false, reason: 'empty' };
                }
                if (normalized.length > 254) {
                  return { ok: false, reason: 'too-long' };
                }
                if (!normalized.includes('@')) {
                  return { ok: false, reason: 'invalid' };
                }
                return { ok: true, value: normalized };
              }
            }
          `,
        },
        {
          file: 'b/PhoneValidator.ts',
          source: `
            export class PhoneValidator {
              validate(value) {
                const normalized = String(value).trim().toLowerCase();
                if (normalized.length === 0) {
                  return { ok: false, reason: 'empty' };
                }
                if (normalized.length > 32) {
                  return { ok: false, reason: 'too-long' };
                }
                if (!normalized.startsWith('+')) {
                  return { ok: false, reason: 'invalid' };
                }
                return { ok: true, value: normalized };
              }
            }
          `,
        },
      ],
    );
    expect(outcome).toBeDefined();
  });

  afterAll(() => {
    console.log('');
    console.log('### ts-twin false positive probe (defaults: minScore=0.82, minNodes=12, minTokens=30)');
    console.log('');
    console.log(
      '| id  | expected  | grouped | score | raw   | tokens (L/R) | nodes (L/R) | verdict             | label |',
    );
    console.log(
      '|-----|-----------|---------|-------|-------|--------------|-------------|---------------------|-------|',
    );

    for (const outcome of outcomes) {
      const expectedGroup = outcome.expected === 'group';
      const verdict = computeVerdict(outcome.grouped, expectedGroup);
      const tokens = outcome.tokens.length === 2 ? `${outcome.tokens[0]} / ${outcome.tokens[1]}` : '-';
      const nodes = outcome.nodes.length === 2 ? `${outcome.nodes[0]} / ${outcome.nodes[1]}` : '-';
      const score = outcome.score === null ? '-' : outcome.score.toFixed(3);
      const raw = outcome.rawScore === null ? '-' : outcome.rawScore.toFixed(3);

      console.log(
        `| ${pad(outcome.id, 3)} | ${pad(outcome.expected, 9)} | ${pad(outcome.grouped ? 'Y' : 'N', 7)} | ${pad(score, 5)} | ${pad(raw, 5)} | ${pad(tokens, 12)} | ${pad(nodes, 11)} | ${pad(verdict, 19)} | ${outcome.label} |`,
      );
    }

    console.log('');
    const unexpectedFalsePositives = outcomes.filter(
      (outcome) => outcome.expected === 'no-group' && outcome.grouped,
    );
    const unexpectedMisses = outcomes.filter(
      (outcome) => outcome.expected === 'group' && !outcome.grouped,
    );
    console.log(
      `Unexpected false positives: ${unexpectedFalsePositives.length} / ${outcomes.length}`,
    );
    if (unexpectedFalsePositives.length > 0) {
      console.log(
        '  ' +
          unexpectedFalsePositives
            .map((outcome) => `${outcome.id} (score=${outcome.score?.toFixed(3) ?? '-'})`)
            .join(', '),
      );
    }
    console.log(
      `Unexpected misses (failed to group a true duplicate): ${unexpectedMisses.length} / ${outcomes.length}`,
    );
    if (unexpectedMisses.length > 0) {
      console.log('  ' + unexpectedMisses.map((outcome) => outcome.id).join(', '));
    }
    console.log('');
  });
});

function computeVerdict(grouped: boolean, expectedGroup: boolean): string {
  if (grouped && expectedGroup) return 'true-positive';
  if (!grouped && !expectedGroup) return 'correctly-rejected';
  if (grouped && !expectedGroup) return 'FALSE-POSITIVE';
  return 'missed-duplicate';
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}
