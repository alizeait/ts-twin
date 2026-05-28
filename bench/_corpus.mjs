/**
 * Generates a corpus of `count` source files. Mode controls the workload:
 *
 *   - 'templated' (default): 8 templates cycled through, so candidates within
 *     each template share many shingles. This is a worst case for the
 *     inverted index.
 *
 *   - 'realistic': ~85% mostly-unique functions (varied AST shapes derived
 *     from the seed) and ~15% templated. Closer to a real large codebase
 *     where the long tail of unique functions dominates.
 */
export function generateCorpus(count, mode = 'templated') {
  const sources = [];
  for (let i = 0; i < count; i += 1) {
    const source =
      mode === 'realistic' && i % 7 !== 0 ? uniqueTemplate(i) : pickTemplate(i);
    sources.push({ file: `gen/file_${i}.ts`, source });
  }
  return sources;
}

function pickTemplate(seed) {
  const template = seed % 8;
  switch (template) {
    case 0: return fetchHandlerTemplate(seed);
    case 1: return reducerTemplate(seed);
    case 2: return validatorTemplate(seed);
    case 3: return formatterTemplate(seed);
    case 4: return middlewareTemplate(seed);
    case 5: return classMethodTemplate(seed);
    case 6: return treeWalkerTemplate(seed);
    default: return arrayPipelineTemplate(seed);
  }
}

/**
 * A unique-ish function: a small computation that varies meaningfully with
 * the seed so different seeds produce different ASTs. This is what the bulk
 * of a real codebase looks like — functions that don't structurally match
 * anything else.
 */
function uniqueTemplate(seed) {
  const s = suffix(seed);
  const ops = ['+', '-', '*', '/', '%', '&', '|', '^'];
  const op1 = ops[seed % ops.length];
  const op2 = ops[(seed >> 3) % ops.length];
  const op3 = ops[(seed >> 6) % ops.length];
  const k1 = 2 + (seed % 17);
  const k2 = 3 + ((seed >> 2) % 23);
  const k3 = 5 + ((seed >> 4) % 31);
  const fields = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
  const f1 = fields[seed % fields.length];
  const f2 = fields[(seed + 1) % fields.length];
  const f3 = fields[(seed + 2) % fields.length];
  return `
    export function compute${s}(input) {
      const ${f1} = (input.a ${op1} ${k1}) ${op2} ${k2};
      const ${f2} = ${f1} ${op3} ${k3};
      if (${f2} < 0) {
        return { kind: '${s}-neg', value: ${f1}, depth: ${seed % 9} };
      }
      const ${f3} = [${f1}, ${f2}, ${k1}, ${k2}, ${k3}].reduce((acc, v) => acc ${op1} v, ${seed % 5});
      const items = (input.items || []).map((entry, idx) => ({
        id: entry.id,
        score: entry.score ${op2} ${f3},
        rank: idx ${op3} ${k2},
      }));
      return { kind: '${s}-ok', value: ${f2}, results: items, hint: '${s}-${f1}' };
    }
  `;
}

const suffix = (seed) => seed.toString(36);

function fetchHandlerTemplate(seed) {
  const s = suffix(seed);
  return `
    export async function fetchEntity${s}(id: string) {
      if (typeof id !== 'string') throw new Error('Invalid id ${s}');
      const response = await fetch('/api/entity${s}/' + id);
      if (!response.ok) {
        throw new Error('Failed entity${s}');
      }
      const data = await response.json();
      return { id: data.id, name: data.name, slug: data.slug, tag: 'entity${s}' };
    }
  `;
}

function reducerTemplate(seed) {
  const s = suffix(seed);
  return `
    export function reducer${s}(state, action) {
      switch (action.type) {
        case 'ADD_${s.toUpperCase()}':
          return { ...state, items: [...state.items, action.payload] };
        case 'REMOVE_${s.toUpperCase()}':
          return { ...state, items: state.items.filter((item) => item.id !== action.payload) };
        case 'UPDATE_${s.toUpperCase()}':
          return { ...state, items: state.items.map((item) => item.id === action.payload.id ? { ...item, ...action.payload } : item) };
        default:
          return state;
      }
    }
  `;
}

function validatorTemplate(seed) {
  const s = suffix(seed);
  const max = 16 + (seed % 64);
  return `
    export function validate${s}(value: unknown) {
      if (typeof value !== 'string') return { ok: false, reason: 'not-string-${s}' };
      const trimmed = value.trim();
      if (trimmed.length === 0) return { ok: false, reason: 'empty-${s}' };
      if (trimmed.length > ${max}) return { ok: false, reason: 'too-long-${s}' };
      if (trimmed.includes(' ')) return { ok: false, reason: 'has-space-${s}' };
      return { ok: true, value: trimmed };
    }
  `;
}

function formatterTemplate(seed) {
  const s = suffix(seed);
  return `
    export function format${s}(record) {
      const parts = [];
      if (record.alpha${s}) parts.push(String(record.alpha${s}).trim());
      if (record.bravo${s}) parts.push(String(record.bravo${s}).trim());
      if (record.charlie${s}) parts.push(String(record.charlie${s}).trim());
      if (record.delta${s}) parts.push(String(record.delta${s}).trim());
      return parts.join('|');
    }
  `;
}

function middlewareTemplate(seed) {
  const s = suffix(seed);
  return `
    export function middleware${s}(req, res, next) {
      try {
        const token = req.headers['x-${s}-token'];
        if (!token) {
          res.status(401).json({ error: 'missing-${s}' });
          return;
        }
        req.context${s} = { token, scope: '${s}' };
        next();
      } catch (error) {
        console.error('middleware${s} failed', error);
        res.status(500).json({ error: 'crashed-${s}' });
      }
    }
  `;
}

function classMethodTemplate(seed) {
  const s = suffix(seed);
  return `
    export class Service${s} {
      run(input) {
        if (!input) return null;
        const normalized = String(input).trim();
        if (normalized.length === 0) return null;
        const result = { kind: '${s}', payload: normalized, retries: 0 };
        result.retries = result.retries + 1;
        return result;
      }
    }
  `;
}

function treeWalkerTemplate(seed) {
  const s = suffix(seed);
  return `
    export function walk${s}(node) {
      if (!node) return [];
      const acc = [];
      const stack = [node];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        acc.push({ id: current.id, kind: '${s}' });
        for (const child of current.children || []) {
          stack.push(child);
        }
      }
      return acc;
    }
  `;
}

function arrayPipelineTemplate(seed) {
  const s = suffix(seed);
  return `
    export function pipeline${s}(items) {
      if (!Array.isArray(items)) return [];
      const filtered = items.filter((entry) => entry != null && entry.kind === '${s}');
      const mapped = filtered.map((entry) => ({ id: entry.id, name: String(entry.name).trim() }));
      const sorted = mapped.sort((a, b) => a.name.localeCompare(b.name));
      return sorted;
    }
  `;
}
