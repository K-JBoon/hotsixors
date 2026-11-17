import { OPS, MEASURES, query, clause, fn, measure } from './model.js';

const TOKEN =
  /\s+|(?<str>"(?:[^"\\]|\\.)*")|(?<num>-?\d[\w.]*)|(?<name>[A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)*)|(?<op>!=|<=|>=|[=<>(),[\]])/y;

const ESCAPES = { n: '\n', t: '\t' };

const unquote = (s) => s.slice(1, -1).replace(/\\(.)/gs, (_, c) => ESCAPES[c] ?? c);

const position = (text, at) => {
  const lines = text.slice(0, at).split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
};

const parseError = (text, at, message) => {
  const { line, column } = position(text, at);
  return Object.assign(new Error(`${line}:${column}: ${message}`), { line, column, reason: message });
};

const tokenize = (text) => {
  const tokens = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(text);
    if (!m) throw parseError(text, at, text[at] === '"' ? 'unterminated string' : `unexpected character ${text[at]}`);
    const [type, raw] = Object.entries(m.groups).find(([, v]) => v != null) ?? [];
    if (type === 'num' && !Number.isFinite(Number(raw))) throw parseError(text, at, `invalid number ${raw}`);
    if (type) tokens.push({ type, raw, at });
  }
  return [...tokens, { type: 'end', raw: 'end of text', at: text.length }];
};

const LITERALS = { true: true, false: false, null: null };

/**
 * Clauses in fixed order, each optional:
 * `from T join J, ... where C and ... group G, ... measure n = M, ... sort k asc|desc limit N view V`.
 * `M` is `kind(arg, ...)` with an optional trailing `where C and ...`; an arg is a column, literal or nested `M`.
 * Values are `"strings"` (`\"`, `\\`, `\n` escapes), numbers, `true`, `false`, `null`, bare words, or `[v, ...]` after `in`.
 * Throws an Error with `line`, `column` and `reason`.
 */
export const parseQuery = (text) => {
  const tokens = tokenize(text);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const fail = (message) => {
    throw parseError(text, peek().at, message);
  };
  const is = (raw, t = peek()) => t.raw === raw;
  const accept = (raw) => is(raw) && Boolean(next());
  const expect = (raw) => accept(raw) || fail(`expected ${raw}, got ${peek().raw}`);
  const name = (what) => (peek().type === 'name' ? next().raw : fail(`expected ${what}, got ${peek().raw}`));
  const list = (item) => {
    const items = [item()];
    while (accept(',')) items.push(item());
    return items;
  };

  const value = () => {
    const t = peek();
    if (t.type === 'str') return unquote(next().raw);
    if (t.type === 'num') return Number(next().raw);
    if (t.type === 'name') return next().raw in LITERALS ? LITERALS[t.raw] : t.raw;
    return fail(`expected a value, got ${t.raw}`);
  };

  const values = () => {
    expect('[');
    if (accept(']')) return [];
    const items = list(value);
    expect(']');
    return items;
  };

  const condition = () => {
    const col = name('a column');
    const op = peek();
    if (!OPS.includes(op.raw)) fail(`expected an operator, got ${op.raw}`);
    next();
    return clause(col, op.raw, op.raw === 'in' ? values() : value());
  };

  const conditions = () => {
    const out = [condition()];
    while (accept('and')) out.push(condition());
    return out;
  };

  const call = () => {
    const kind = name('a measure');
    expect('(');
    const args = is(')') ? [] : list(argument);
    expect(')');
    return fn(kind, args, accept('where') ? conditions() : []);
  };

  const argument = () => (peek().type === 'name' && is('(', tokens[i + 1]) ? call() : value());

  const named = () => {
    const n = name('a measure name');
    expect('=');
    return measure(n, call());
  };

  const sort = () => {
    const by = name('a sort key');
    if (accept('asc')) return { by, dir: 'asc' };
    accept('desc');
    return { by, dir: 'desc' };
  };

  const limit = () => {
    const t = peek();
    return t.type === 'num' ? Number(next().raw) : fail(`expected a number, got ${t.raw}`);
  };

  const CLAUSES = [
    ['from', 'from', () => name('a base table')],
    ['join', 'joins', () => list(() => name('a join'))],
    ['where', 'where', conditions],
    ['group', 'group', () => list(() => name('a column'))],
    ['measure', 'measures', () => list(named)],
    ['sort', 'sort', sort],
    ['limit', 'limit', limit],
    ['view', 'view', () => name('a view')],
  ];

  const parts = {};
  for (const [keyword, key, parse] of CLAUSES) if (accept(keyword)) parts[key] = parse();
  if (peek().type !== 'end') {
    const known = CLAUSES.some(([k]) => is(k));
    fail(known ? `${peek().raw} is out of order or repeated` : `unexpected ${peek().raw}`);
  }
  return query(parts);
};

const WORD = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;

const quote = (s) => `"${s.replace(/[\\"\n\t]/g, (c) => ({ '\n': '\\n', '\t': '\\t' })[c] ?? `\\${c}`)}"`;

const printValue = (v) => (typeof v === 'string' ? quote(v) : String(v));

const printWord = (v) => (typeof v === 'string' && WORD.test(v) && !(v in LITERALS) ? v : printValue(v));

const printConditions = (clauses) =>
  clauses
    .map(({ col, op, value }) => `${col} ${op} ${op === 'in' ? `[${value.map(printValue).join(', ')}]` : printValue(value)}`)
    .join(' and ');

export const printCall = ({ kind, args = [], where = [] }) => {
  const params = MEASURES[kind]?.params ?? [];
  const arg = (a, i) =>
    a !== null && typeof a === 'object' ? printCall(a) : params[i]?.startsWith('col') ? printWord(a) : printValue(a);
  const filter = where.length ? ` where ${printConditions(where)}` : '';
  return `${kind}(${args.map(arg).join(', ')})${filter}`;
};

/** Inverse of `parseQuery`, on one line. Strings in values are always quoted; empty clauses are left out. */
export const printQuery = (q) =>
  [
    `from ${q.from}`,
    q.joins.length && `join ${q.joins.join(', ')}`,
    q.where.length && `where ${printConditions(q.where)}`,
    q.group.length && `group ${q.group.join(', ')}`,
    q.measures.length && `measure ${q.measures.map(({ name, ...m }) => `${name} = ${printCall(m)}`).join(', ')}`,
    q.sort && `sort ${q.sort.by}${q.sort.dir ? ` ${q.sort.dir}` : ''}`,
    q.limit != null && `limit ${q.limit}`,
    `view ${q.view}`,
  ]
    .filter(Boolean)
    .join(' ');
