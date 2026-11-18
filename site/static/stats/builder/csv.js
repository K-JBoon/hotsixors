import { kindOf } from './model.js';

const isSized = (v) => v != null && typeof v === 'object';

const field = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

const keyColumns = (names) => (ref) => {
  const name = names[kindOf(ref)];
  const own = { label: ref, get: (r) => r[ref] };
  return name ? [own, { label: `${ref}_name`, get: (r) => (r[ref] == null ? null : name(r[ref])) }] : [own];
};

const metricColumns = (rows) => (m) => {
  const own = { label: m.name, get: (r) => (isSized(r[m.name]) ? r[m.name].value : r[m.name]) };
  return rows.some((r) => isSized(r[m.name])) ? [own, { label: `${m.name}_n`, get: (r) => r[m.name]?.n }] : [own];
};

/** RFC 4180 text of a `runQuery` result. `names` maps a column kind (`hero`, `talent`) to an ID-to-name function. */
export const toCsv = ({ rows }, q, names) => {
  const keys = q.facet == null ? q.dimensions : [q.facet, ...q.dimensions];
  const columns = [...keys.flatMap(keyColumns(names)), ...q.metrics.flatMap(metricColumns(rows))];
  return [columns.map((c) => field(c.label)), ...rows.map((r) => columns.map((c) => field(c.get(r))))]
    .map((line) => line.join(','))
    .join('\r\n')
    .concat('\r\n');
};

export const csvFileName = (name) => `${name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '').trim() || 'query'}.csv`;
