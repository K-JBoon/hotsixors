import { OPS, query, clause, fn, metric, paramType } from './model.js';

const TOKEN =
  /\s+|(?<str>'(?:[^']|'')*')|(?<ident>"(?:[^"]|"")*")|(?<num>-?\d[\w.]*)|(?<name>[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|(?<op>!=|<>|<=|>=|[=<>(),])/y;

const KEYWORDS = new Set(
  'select from join where group facet having by order limit view as filter and in asc desc true false null'.split(' '),
);

const LITERALS = { true: true, false: false, null: null };

const unquote = (s) => s.slice(1, -1).replaceAll(s[0].repeat(2), s[0]);

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
    if (!m) throw parseError(text, at, `'"`.includes(text[at]) ? 'unterminated quote' : `unexpected character ${text[at]}`);
    const [type, raw] = Object.entries(m.groups).find(([, v]) => v != null) ?? [];
    if (type === 'num' && !Number.isFinite(Number(raw))) throw parseError(text, at, `invalid number ${raw}`);
    if (type) tokens.push({ type, raw, at });
  }
  return [...tokens, { type: 'end', raw: 'end of text', at: text.length }];
};

const keywordOf = (t) => (t.type === 'name' && KEYWORDS.has(t.raw.toLowerCase()) ? t.raw.toLowerCase() : null);

const isIdent = (t) => t.type === 'ident' || (t.type === 'name' && !keywordOf(t));

const OP_ALIASES = { '<>': '!=' };

/**
 * `SELECT item, ... FROM t JOIN j, ... WHERE c AND ... GROUP BY col, ... FACET BY col HAVING count() >= n ORDER BY k ASC|DESC LIMIT n VIEW v`.
 * Every clause is optional; keywords ignore case. An item is a dimension or `call AS name`.
 * Dimensions in SELECT must equal GROUP BY; the facet column may also appear. A call is `kind(arg, ...)` with an optional `FILTER (WHERE c AND ...)`.
 * Values are `'strings'` (`''` escapes a quote), numbers, `TRUE`, `FALSE`, `NULL`, or `(v, ...)` after `IN`.
 * `"quoted"` names escape keywords and other characters. Throws an Error with `line`, `column` and `reason`.
 */
export const parseQuery = (text) => {
  const tokens = tokenize(text);
  let i = 0;
  const peek = (k = 0) => tokens[i + k];
  const next = () => tokens[i++];
  const fail = (message, at = peek().at) => {
    throw parseError(text, at, message);
  };
  const is = (raw, t = peek()) => (KEYWORDS.has(raw) ? keywordOf(t) === raw : t.type === 'op' && t.raw === raw);
  const accept = (raw) => is(raw) && Boolean(next());
  const shown = (raw) => (KEYWORDS.has(raw) ? raw.toUpperCase() : raw);
  const expect = (raw) => accept(raw) || fail(`expected ${shown(raw)}, got ${peek().raw}`);
  const identifier = (what) => {
    const t = peek();
    if (!isIdent(t)) return fail(`expected ${what}, got ${t.raw}`);
    next();
    return t.type === 'ident' ? unquote(t.raw) : t.raw;
  };
  const list = (item) => {
    const items = [item()];
    while (accept(',')) items.push(item());
    return items;
  };
  const parens = (item) => {
    expect('(');
    if (accept(')')) return [];
    const items = list(item);
    expect(')');
    return items;
  };

  const value = () => {
    const t = peek();
    if (t.type === 'str') return unquote(next().raw);
    if (t.type === 'num') return Number(next().raw);
    const k = keywordOf(t);
    if (k && k in LITERALS) return next() && LITERALS[k];
    if (t.type === 'ident') return fail(`strings take single quotes, got ${t.raw}`);
    if (isIdent(t)) return fail(`unquoted value ${t.raw}`);
    return fail(`expected a value, got ${t.raw}`);
  };

  const condition = () => {
    const col = identifier('a column');
    const t = peek();
    const op = OP_ALIASES[t.raw] ?? keywordOf(t) ?? t.raw;
    if (!OPS.includes(op)) fail(`expected an operator, got ${t.raw}`);
    next();
    return clause(col, op, op === 'in' ? parens(value) : value());
  };

  const conditions = () => {
    const out = [condition()];
    while (accept('and')) out.push(condition());
    return out;
  };

  const startsCall = () => peek().type === 'name' && !keywordOf(peek()) && is('(', peek(1));

  const argument = (kind, n) => {
    if (startsCall()) return call();
    const type = paramType(kind, n);
    if (type === 'col') return identifier('a column');
    if (type === 'metric') return fail(`expected a metric, got ${peek().raw}`);
    return type || !isIdent(peek()) ? value() : identifier('a column');
  };

  const call = () => {
    const kind = startsCall() ? next().raw : fail(`expected a metric, got ${peek().raw}`);
    expect('(');
    const args = [];
    if (!accept(')')) {
      args.push(argument(kind, 0));
      while (accept(',')) args.push(argument(kind, args.length));
      expect(')');
    }
    if (!accept('filter')) return fn(kind, args);
    expect('(');
    expect('where');
    const where = conditions();
    expect(')');
    return fn(kind, args, where);
  };

  const item = () => {
    const at = peek().at;
    if (isIdent(peek()) && !startsCall()) return { col: identifier('a column'), at };
    if (!startsCall()) return fail(`expected a column or metric, got ${peek().raw}`);
    const m = call();
    expect('as');
    return { metric: metric(identifier('a metric name'), m) };
  };

  const joins = () => {
    const out = list(() => identifier('a join'));
    while (accept('join')) out.push(...list(() => identifier('a join')));
    return out;
  };

  const sort = () => {
    const by = identifier('a sort key');
    return { by, dir: accept('asc') ? 'asc' : (accept('desc'), 'desc') };
  };

  const number = () => (peek().type === 'num' ? Number(next().raw) : fail(`expected a number, got ${peek().raw}`));

  const having = () => {
    if (peek().raw !== 'count') fail(`expected count(), got ${peek().raw}`);
    next();
    expect('(');
    expect(')');
    expect('>=');
    return number();
  };

  const after = (word, parse) => () => (expect(word), parse());

  const facet = () => {
    const col = identifier('a column');
    if (is(',')) fail('FACET BY takes one column');
    return col;
  };

  const CLAUSES = [
    ['select', 'select', () => list(item)],
    ['from', 'from', () => identifier('a base table')],
    ['join', 'joins', joins],
    ['where', 'where', conditions],
    ['group', 'dimensions', after('by', () => list(() => identifier('a column')))],
    ['facet', 'facet', after('by', facet)],
    ['having', 'having', having],
    ['order', 'sort', after('by', sort)],
    ['limit', 'limit', number],
    ['view', 'view', () => identifier('a view')],
  ];

  const parts = {};
  for (const [keyword, key, parse] of CLAUSES) if (accept(keyword)) parts[key] = parse();
  if (peek().type !== 'end') {
    const k = keywordOf(peek());
    fail(CLAUSES.some(([c]) => c === k) ? `${k.toUpperCase()} is out of order or repeated` : `unexpected ${peek().raw}`);
  }

  const { select = [], ...rest } = parts;
  const cols = select.filter((s) => 'col' in s && s.col !== rest.facet);
  const dimensions = rest.dimensions ?? [];
  const stray = cols.find((c) => !dimensions.includes(c.col));
  if (stray) fail(`${stray.col} is not in GROUP BY${rest.facet == null ? '' : ' or FACET BY'}`, stray.at);
  if (cols.length && cols.map((c) => c.col).join('\0') !== dimensions.join('\0')) fail('SELECT columns must match GROUP BY', cols[0].at);
  return query({ ...rest, metrics: select.filter((s) => s.metric).map((s) => s.metric) });
};

const WORD = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;

const ident = (s) => (WORD.test(s) && !KEYWORDS.has(s.toLowerCase()) ? s : `"${String(s).replaceAll('"', '""')}"`);

const printValue = (v) =>
  typeof v === 'string' ? `'${v.replaceAll("'", "''")}'` : v == null || typeof v === 'boolean' ? String(v).toUpperCase() : String(v);

const printConditions = (clauses) =>
  clauses
    .map(({ col, op, value }) => `${ident(col)} ${op === 'in' ? `IN (${value.map(printValue).join(', ')})` : `${op} ${printValue(value)}`}`)
    .join(' AND ');

export const printCall = ({ kind, args = [], where = [] }) => {
  const arg = (a, i) =>
    a !== null && typeof a === 'object' ? printCall(a) : paramType(kind, i) === 'col' ? ident(a) : printValue(a);
  const filter = where.length ? ` FILTER (WHERE ${printConditions(where)})` : '';
  return `${kind}(${args.map(arg).join(', ')})${filter}`;
};

const SELECT_WIDTH = 80;

const printSelect = (items) => {
  const line = `SELECT ${items.join(', ')}`;
  return line.length <= SELECT_WIDTH ? line : `SELECT ${items.join(',\n       ')}`;
};

/** Inverse of `parseQuery`, one clause per line. Empty clauses and `VIEW table` are left out. */
export const printQuery = (q) =>
  [
    (q.dimensions.length || q.facet != null || q.metrics.length) &&
      printSelect([...q.dimensions.map(ident), ...(q.facet == null ? [] : [ident(q.facet)]), ...q.metrics.map(({ name, ...m }) => `${printCall(m)} AS ${ident(name)}`)]),
    `FROM ${ident(q.from)}${q.joins.map((j) => ` JOIN ${ident(j)}`).join('')}`,
    q.where.length && `WHERE ${printConditions(q.where)}`,
    q.dimensions.length && `GROUP BY ${q.dimensions.map(ident).join(', ')}`,
    q.facet != null && `FACET BY ${ident(q.facet)}`,
    q.having != null && `HAVING count() >= ${q.having}`,
    q.sort && `ORDER BY ${ident(q.sort.by)} ${(q.sort.dir ?? 'desc').toUpperCase()}`,
    q.limit != null && `LIMIT ${q.limit}`,
    q.view !== 'table' && `VIEW ${ident(q.view)}`,
  ]
    .filter(Boolean)
    .join('\n');
